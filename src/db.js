const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { jwtDecode } = require('jwt-decode');
const api = require('./api');

let db;

async function initDB() {
	db = await open({
		filename: './db.sqlite',
		driver: sqlite3.Database,
	});
	await db.exec(
		'CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, token TEXT, exp INTEGER)',
	);
}

async function getValidToken() {
	const row = await db.get('SELECT token, exp FROM config WHERE id = 1');
	const now = Math.floor(Date.now() / 1000);

	if (row && row.token && row.exp > now + 300) {
		return row.token;
	}

	const newToken = await api.getAuthToken();
	if (!newToken) throw new Error('Falha ao obter token via Puppeteer');

	const decoded = jwtDecode(newToken);

	await db.run(
		'INSERT OR REPLACE INTO config (id, token, exp) VALUES (1, ?, ?)',
		[newToken, decoded.exp],
	);

	return newToken;
}

module.exports = {
	initDB,
	getValidToken,
};
