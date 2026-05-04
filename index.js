require('dotenv').config({ quiet: true });

const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const db = require('./src/db');
const utils = require('./src/utils');
const booking = require('./src/booking');

const UUID_TABLE = process.env.UUID_TABLE;
const USER_WHATS_ID = process.env.USER_WHATS_ID;

let session = {};

const client = new Client({ authStrategy: new LocalAuth() });

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('WhatsApp conectado.'));

async function sendMenu() {
	session.step = 'MAIN_MENU';
	const options = [
		'*1* - Ver Reservas',
		'*2* - Reservar Mesa',
		'*3* - Cancelar Reserva',
		'*0* - Sair',
	];
	await client.sendMessage(
		USER_WHATS_ID,
		`*MENU PRINCIPAL:*\n\n${options.join('\n')}`,
	);
}

cron.schedule('1 0 * * *', async () => {
	const date = utils.getFutureDate(7);
	if (date.getDay() === 0 || date.getDay() === 6) return;

	const result = await booking.doBooking(date, UUID_TABLE);
	if (!result.error) {
		await client.sendMessage(
			USER_WHATS_ID,
			`Reserva automática efetuada para ${utils.dateFormatFromMsg(date)} na Mesa 19!`,
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

	session.step = 'DAILY_CONFIRMATION';
	session.booking = tomorrowBooking[0];
	await client.sendMessage(
		USER_WHATS_ID,
		`Você tem uma reserva para amanhã na Mesa ${tomorrowBooking[0].tableId}.\nQuer manter essa reserva?:\n*1* - Sim\n*2* - Não`,
	);
});

client.on('message', async (msg) => {
	if (msg.from !== USER_WHATS_ID) return;
	const text = msg.body.trim().toLowerCase();

	// Verifica se usuário inicou serviço ou ignora mensagem
	if (!session.step) {
		if (text === '/start') {
			await sendMenu();
		}
		return;
	}

	// Opções do Menu Principal
	if (session.step === 'MAIN_MENU') {
		// Escolha 0 - Sair
		if (text === '0') {
			session = {};
			await client.sendMessage(USER_WHATS_ID, 'Até mais!');
			return;
		}
		// Escolha 1 - Ver reservas
		if (text === '1') {
			session.step = 'VIEW_BOOKINGS';
			const bookings = await booking.getBookings();
			if (bookings.length === 0) {
				await client.sendMessage(
					USER_WHATS_ID,
					'Nenhuma reserva encontrada.\n\nDigite *0* para voltar ao menu principal.',
				);
			} else {
				const list = bookings
					.map((b) => `Mesa ${b.tableId} | ${b.formattedDate}`)
					.join('\n');
				await client.sendMessage(
					USER_WHATS_ID,
					`*SUAS RESERVAS:*\n\n${list}\n\nDigite *0* para voltar ao menu principal.`,
				);
			}
			return;
		}

		// Escolha 2 - Reservar Mesa
		if (text === '2') {
			const workDays = utils.getNextWorkDays();
			session.days = workDays;
			session.step = 'CHOOSE_RESERVATION_DATE';

			const dateMenu = workDays
				.map((d, i) => `*${i + 1}* - ${d.formated}`)
				.join('\n');
			await client.sendMessage(
				USER_WHATS_ID,
				`*SELECIONE A DATA PARA RESERVAR:*\n\n${dateMenu}\n\nOu digite *0* para voltar ao menu principal.`,
			);
			return;
		}

		// Escolha 3 - Cancelar Reserva
		if (text === '3') {
			const currentBookings = await booking.getBookings();
			if (currentBookings.length === 0) {
				session.step = 'VIEW_BOOKINGS';
				await client.sendMessage(
					USER_WHATS_ID,
					'Nenhuma reserva encontrada.\n\nDigite *0* para voltar ao menu principal.',
				);
				return;
			}

			session.bookings = currentBookings;
			session.step = 'CHOOSE_RESERVATION_CANCELLATION';
			const bookingsMenu = currentBookings
				.map((r, i) => {
					return `*${i + 1}* - Mesa ${r.tableId} | ${r.formattedDate}`;
				})
				.join('\n');
			await client.sendMessage(
				USER_WHATS_ID,
				`*SELECIONE A RESERVA PARA CANCELAR:*\n\n${bookingsMenu}\n\nOu digite *0* para voltar ao menu principal.`,
			);
			return;
		}
	// Opção para voltar ao menu principal em qualquer etapa
	} else if (text === '0') {
		await sendMenu();
		return;
	}

	// Confirmação diária para ir ao escritório no dia seguinte
	if (session.step === 'DAILY_CONFIRMATION') {
		if (text === '2') {
			const result = await booking.cancelBooking(session.booking.uuid);
			await client.sendMessage(
				USER_WHATS_ID,
				result.success
					? 'Reserva cancelada.'
					: 'Nenhuma reserva encontrada.',
			);
		}
		session = {};
		return;
	}

	// Fluxo de escolha de data para reserva
	if (session.step === 'CHOOSE_RESERVATION_DATE') {
		const chosenDate = session.days[parseInt(text) - 1];

		if (!chosenDate) {
			await client.sendMessage(USER_WHATS_ID, 'Opção inválida.');
			return;
		}

		const result = await booking.doBooking(chosenDate.date, UUID_TABLE);
		if (!result.error) {
			await client.sendMessage(
				USER_WHATS_ID,
				`Reserva efetuada para Mesa *19* | ${chosenDate.formated}`,
			);
			await sendMenu();
			return;
		} else if (result.error === 412) {
			const tables = await booking.listFreeTables(chosenDate.date);
			if (tables.length === 0) {
				await client.sendMessage(
					USER_WHATS_ID,
					'Nenhuma mesa livre entre 17 e 44.',
				);
				await sendMenu();
				return;
			} else {
				session.tables = tables;
				session.chosenDate = chosenDate;
				session.step = 'CHOSE_TABLE_RESERVATION';

				const tableIdList = tables.map((m) => m.id).join('*, *');
				await client.sendMessage(
					USER_WHATS_ID,
					`*MESA 19 OCUPADA*\n\nEscolha uma das mesas livres:\n*${tableIdList}*\n\nOu digite *0* para cancelar.`,
				);
				return;
			}
		} else {
			await client.sendMessage(
				USER_WHATS_ID,
				'Erro ao tentar reservar a mesa. Tente novamente mais tarde.',
			);
			await sendMenu();
			return;
		}
	}

	// Fluxo de escolha de mesa para reserva
	if (session.step === 'CHOSE_TABLE_RESERVATION') {
		const chosenTable = session.tables.find((m) => m.id === text);

		if (!chosenTable) {
			await client.sendMessage(
				USER_WHATS_ID,
				'Mesa inválida. Operação cancelada.',
			);
			return;
		}
		const result = await booking.doBooking(session.chosenDate.date, chosenTable.uuid);
		if (!result.error) {
			await client.sendMessage(
				USER_WHATS_ID,
				`Reserva efetuada para Mesa *${chosenTable.id}* | ${session.chosenDate.formated}`,
			);
		} else {
			await client.sendMessage(USER_WHATS_ID, 'Erro ao reservar a mesa.');
		}
		await sendMenu();
		return;
	}

	// Fluxo de escolha de reserva para cancelamento
	if (session.step === 'CHOOSE_RESERVATION_CANCELLATION') {
		const chosenBooking = session.bookings[parseInt(text) - 1];

		if (!chosenBooking) {
			await client.sendMessage(USER_WHATS_ID, 'Opção inválida.');
			return;
		}

		const result = await booking.cancelBooking(chosenBooking.uuid);
		if (!result.error) {
			await client.sendMessage(
				USER_WHATS_ID,
				'Reserva cancelada com sucesso.',
			);
		} else {
			console.error('Erro ao cancelar reserva:', result);
			await client.sendMessage(
				USER_WHATS_ID,
				'Erro ao cancelar a reserva.',
			);
		}

		await sendMenu();
		return;
	}
});

db.initDB()
	.then(() => {
		client.initialize();
	})
	.catch(console.error);
