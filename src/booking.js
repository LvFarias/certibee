const axios = require('axios');

const db = require('./db');
const api = require('./api');
const utils = require('./utils');

const PLANT_UUID = process.env.PLANT_UUID;

async function getBookings() {
	const token = await db.getValidToken();
	const response = await api.get('bookings/me?limit=10', token);
	const bookings = response.data || [];
	return bookings.map((b) => {
		return {
			uuid: b.uuid || b.booking_uuid,
			date: new Date(b.start_date),
			tableId: utils.getTableId(b.place.name),
			formattedDate: utils.dateFormatFromMsg(new Date(b.start_date)),
		};
	});
}

async function doBooking(date, uuid) {
	const token = await db.getValidToken();
	const end_date = utils.dateFormatFromRequest(date);
	const start_date = utils.dateFormatFromRequest(date);
	const response = await api.post(
		'bookings',
		{
			uuid,
			end_date,
			start_date,
			reason: '',
			end_hour: '18:00',
			start_hour: '10:00',
			booking_uuid_identifier: null,
		},
		token,
	);
	return response;
}

async function cancelBooking(uuid) {
	const token = await db.getValidToken();
	const response = await api.deleteRequest(`bookings/${uuid}`, token);
	return response;
}

async function listFreeTables(date) {
	const token = await db.getValidToken();
	const datetime =
		encodeURIComponent(utils.dateFormatFromRequest(date)) +
		'%3B10:00%3B18:00';
	const queryParams = {
		datetime,
		place_uuid: '',
		state_uuid: '',
		type: 'workspace',
		'search-field': '',
		is_by_pass_state: false,
		is_service_booking: false,
		is_by_pass_restriction: false,
		search: 'is_my_allocated:%3Bsector_uuid:',
	};

	const response = await api.get(
		`/plant/${PLANT_UUID}/places?${datetime.join('&')}`,
		token,
	);
	const tables = response.data || [];
	return tables
		.filter(
			(t) =>
				utils.getTableId(t.name) >= 17 &&
				utils.getTableId(t.name) <= 44 &&
				t.state.name === 'free',
		)
		.map((t) => {
			return { id: utils.getTableId(t.name), uuid: t.uuid };
		});
}

module.exports = {
	getBookings,
	doBooking,
	cancelBooking,
	listFreeTables,
};
