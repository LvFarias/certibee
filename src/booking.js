const axios = require('axios');

const db = require('./db');
const api = require('./api');
const utils = require('./utils');

const PLANT_UUID = process.env.PLANT_UUID;
const START_HOUR = process.env.START_HOUR;
const END_HOUR = process.env.END_HOUR;

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
			end_hour: END_HOUR,
			start_hour: START_HOUR,
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
	const queryParams = {
		place_uuid: '',
		state_uuid: '',
		type: 'workspace',
		'search-field': '',
		is_by_pass_state: false,
		is_service_booking: false,
		is_by_pass_restriction: false,
		search: 'is_my_allocated:%3Bsector_uuid:',
		datetime: `${utils.dateFormatFromRequest(date, true)}%3B${START_HOUR}%3B${END_HOUR}`,
	};
	const params = Object.entries(queryParams)
		.map((p) => p.join('='))
		.join('&');

	const response = await api.get(
		`plant/${PLANT_UUID}/places?${params}`,
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
