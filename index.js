require('dotenv').config({ quiet: true });

const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = require('./src/db');
const utils = require('./src/utils');
const booking = require('./src/booking');

const UUID_TABLE = process.env.UUID_TABLE;
const USER_NUMBER = process.env.USER_NUMBER;
const USER_WHATS_ID = process.env.USER_WHATS_ID;

const states = {};

const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('WhatsApp conectado.'));

async function sendMenu(to) {
	states[to] = { step: 'MAIN_MENU' };
	await client.sendMessage(
		to,
		`Menu Principal:\n*1* - Ver Reservas\n*2* - Reservar\n*3* - Cancelar\n*0* - Sair`,
	);
}

cron.schedule('1 0 * * *', async () => {
	const date = utils.getFutureDate(7);
	if (date.getDay() === 0 || date.getDay() === 6) return;
	const result = await booking.doBooking(date, UUID_TABLE);
	if (!result.error) {
		await client.sendMessage(
			USER_NUMBER,
			`Reserva automática efetuada para ${utils.dateFormatFromMsg(date)}`,
		);
	} else {
		console.error('Erro ao fazer reserva automática:', result);
	}
});

cron.schedule('0 10 * * *', async () => {
	const list = await booking.getBookings();
	if (list.length === 0) return;
	const tomorrow = utils.getFutureDate(1);
	const tomorrowBooking = list.filter((b) => {
		return (
			b.date.getDate() === tomorrow.getDate() &&
			b.date.getMonth() === tomorrow.getMonth() &&
			b.date.getFullYear() === tomorrow.getFullYear()
		);
	});
	if (tomorrowBooking.length === 0) return;

	states[USER_NUMBER] = {
		step: 'DAILY_CONFIRMATION',
		booking: tomorrowBooking[0],
	};
	await client.sendMessage(
		USER_NUMBER,
		`Você tem uma reserva para amanhã na Mesa ${tomorrowBooking[0].tableId}.\nQuer manter essa reserva?:\n*1* - Sim\n*2* - Não`,
	);
});

client.on('message', async (msg) => {
	if (msg.from !== USER_WHATS_ID) return;

	const text = msg.body.trim().toLowerCase();
	const currentState = states[msg.from] || {};

	// Confirmação diária para ir ao escritório no dia seguinte
	if (currentState.step === 'DAILY_CONFIRMATION') {
		if (text === '2') {
			const result = await booking.cancelBooking(
				currentState.booking.uuid,
			);
			await client.sendMessage(
				msg.from,
				result.success
					? 'Reserva cancelada.'
					: 'Nenhuma reserva encontrada.',
			);
		}
		await sendMenu(msg.from);
		return;
	}

	// Opção de voltar ao menu principal
	if (text === '0') {
		if (currentState.step === 'MAIN_MENU') {
			delete states[msg.from];
			await client.sendMessage(msg.from, 'Até mais!');
			return;
		}
		await sendMenu(msg.from);
		return;
	}

	// Fluxo de escolha de data para reserva
	if (currentState.step === 'CHOOSE_RESERVATION_DATE') {
		const chosenDate = currentState.days[parseInt(text) - 1];

		if (!chosenDate) {
			await client.sendMessage(msg.from, 'Opção inválida.');
			return;
		}

		const result = await booking.doBooking(chosenDate.date, UUID_TABLE);
		if (!result.error) {
			await client.sendMessage(
				msg.from,
				`Reserva efetuada para ${chosenDate.formated}`,
			);
			await sendMenu(msg.from);
			return;
		} else if (result.error === 412) {
			const tables = await booking.listFreeTables(chosenDate.date);
			if (tables.length === 0) {
				await client.sendMessage(
					msg.from,
					'Mesa principal ocupada e nenhuma mesa livre entre 17 e 44.',
				);
				await sendMenu(msg.from);
				return;
			} else {
				states[msg.from] = {
					step: 'CHOSE_TABLE_RESERVATION',
					chosenDate: chosenDate,
					tables,
				};
				const tableIdList = tables.map((m) => m.id).join('*, *');
				await client.sendMessage(
					msg.from,
					`Mesa principal ocupada.\nLivres: *${tableIdList}*\n\nDigite o número da mesa desejada\nOu digite *0* para cancelar.`,
				);
				return;
			}
		} else {
			await client.sendMessage(
				msg.from,
				'Erro ao tentar reservar a mesa. Tente novamente mais tarde.',
			);
			await sendMenu(msg.from);
			return;
		}
	}

	// Fluxo de escolha de mesa para reserva
	if (currentState.step === 'CHOSE_TABLE_RESERVATION') {
		const chosenTable = currentState.tables.find((m) => m.id === text);

		if (!chosenTable) {
			await client.sendMessage(
				msg.from,
				'Mesa inválida. Operação cancelada.',
			);
			return;
		}
		await booking.doBooking(currentState.chosenDate.date, chosenTable.uuid);
		if (!result.error) {
			await client.sendMessage(
				msg.from,
				`Reserva efetuada para Mesa *${chosenTable.id}* | ${currentState.chosenDate.formated}`,
			);
		} else {
			await client.sendMessage(msg.from, 'Erro ao reservar a mesa.');
		}
		await sendMenu(msg.from);
		return;
	}

	// Fluxo de escolha de reserva para cancelamento
	if (currentState.step === 'CHOOSE_RESERVATION_CANCELLATION') {
		const chosenBooking = currentState.bookings[parseInt(text) - 1];

		if (!chosenBooking) {
			await client.sendMessage(msg.from, 'Opção inválida.');
			return;
		}

		const result = await booking.cancelBooking(chosenBooking.uuid);
		if (!result.error) {
			await client.sendMessage(msg.from, 'Erro ao cancelar a reserva.');
		} else {
			await client.sendMessage(
				msg.from,
				'Reserva cancelada com sucesso.',
			);
		}

		await sendMenu(msg.from);
		return;
	}

	// Fluxo principal do menu
	if (currentState.step === 'MAIN_MENU') {
		// Escolha 1 - Ver reservas
		if (text === '1') {
			const bookings = await booking.getBookings();
			if (bookings.length === 0) {
				await client.sendMessage(
					msg.from,
					'Nenhuma reserva encontrada.',
				);
			} else {
				const list = bookings
					.map((b) => `Mesa ${b.tableId} | ${b.formattedDate}`)
					.join('\n');
				await client.sendMessage(msg.from, list);
			}
			await sendMenu(msg.from);
			return;
		}

		// Escolha 2 - Reservar Mesa
		if (text === '2') {
			const workDays = utils.getNextWorkDays();
			states[msg.from] = {
				step: 'CHOOSE_RESERVATION_DATE',
				days: workDays,
			};
			const dateMenu = workDays
				.map((d, i) => `*${i + 1}* - ${d.formated}`)
				.join('\n');
			await client.sendMessage(
				msg.from,
				`Selecione a data para reservar:\n${dateMenu}\nOu digite *0* para voltar ao menu principal.`,
			);
			return;
		}

		// Escolha 3 - Cancelar Reserva
		if (text === '3') {
			const currentBookings = await booking.getBookings();

			if (currentBookings.length === 0) {
				await client.sendMessage(
					msg.from,
					'Nenhuma reserva encontrada.',
				);
				await sendMenu(msg.from);
				return;
			}

			states[msg.from] = {
				step: 'CHOOSE_RESERVATION_CANCELLATION',
				bookings: currentBookings,
			};

			const bookingsMenu = currentBookings
				.map((r, i) => {
					return `*${i + 1}* - Mesa ${r.tableId} | ${r.formattedDate}`;
				})
				.join('\n');

			await client.sendMessage(
				msg.from,
				`Selecione a reserva para cancelar:\n${bookingsMenu}\nOu digite *0* para voltar ao menu principal.`,
			);
			return;
		}
	}

	if (text === '/start') {
		await sendMenu(msg.from);
	}
});

db.initDB()
	.then(() => {
		client.initialize();
	})
	.catch(console.error);
