const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { TOTP } = require('totp-generator');

const API_URL = 'https://api.deskbee.io/api';
const HEADERS_BASE = {
	'x-app-account': 'certisign',
	'x-app-version': '1.237.6074',
	Accept: 'application/json',
	'Content-Type': 'application/json',
};

async function post(url, data, token) {
	try {
		const response = await axios.post(`${API_URL}/${url}`, data, {
			headers: { ...HEADERS_BASE, Authorization: `Bearer ${token}` },
		});
		return response.data;
	} catch (error) {
		return {
			error: error.response?.status || 500,
			message: error.message,
			response: error.response,
		};
	}
}

async function get(url, token) {
	try {
		const response = await axios.get(`${API_URL}/${url}`, {
			headers: { ...HEADERS_BASE, Authorization: `Bearer ${token}` },
		});
		return response.data;
	} catch (error) {
		console.error(error);
		return { error: error.response?.status || 500, message: error.message };
	}
}

async function deleteRequest(url, token) {
	try {
		await axios.delete(`${API_URL}/${url}`, {
			headers: { ...HEADERS_BASE, Authorization: `Bearer ${token}` },
		});
		return { success: true };
	} catch (error) {
		return { error: error.response?.status || 500, message: error.message };
	}
}

async function getAuthToken() {
	console.log('Iniciando processo de autenticação SSO...');
	const browser = await puppeteer.launch({
		headless: true,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-blink-features=AutomationControlled',
			'--window-size=1920,1080',
		],
	});
	const page = await browser.newPage();
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	);
	let token = null;

	page.on('request', (request) => {
		const headers = request.headers();
		if (
			headers['authorization'] &&
			headers['authorization'].startsWith('Bearer ')
		) {
			token = headers['authorization'].split(' ')[1];
		}
	});
	
	console.log('Carregando página de login do Deskbee...');
	await page.goto('https://certisign.deskbee.app/login', {
		waitUntil: 'networkidle2',
	});

	console.log('Procurando e clicando no botão de SSO...');
	await page.evaluate(() => {
		const elements = Array.from(document.querySelectorAll('button, a'));
		const ssoButton = elements.find((el) =>
			el.textContent.toLowerCase().includes('sso'),
		);
		if (ssoButton) ssoButton.click();
	});

	console.log('Redirecionando para a Microsoft e iniciando fluxo de autenticação...');
	await page.waitForNavigation({ waitUntil: 'networkidle2' });

	console.log('Preenchendo Email...');
	await page.waitForSelector('input[type="email"]', { visible: true });
	await page.type('input[type="email"]', process.env.SSO_EMAIL);
	await page.click('input[type="submit"]');

	console.log('Preenchendo Senha...');
	await page.waitForSelector('input[type="password"]', { visible: true });
	// Pausa necessária devido às animações da página da Microsoft
	await new Promise((r) => setTimeout(r, 1500));
	await page.type('input[type="password"]', process.env.SSO_PASSWORD);
	await page.click('input[type="submit"]');

	// Aguarda o campo de 2FA da Microsoft carregar
	await page.waitForSelector('input[name="otc"]', { visible: true });

	console.log('Gerando código TOTP para 2FA...');
	const token2FA = (await TOTP.generate(process.env.SECRET_2FA_KEY)).otp;

	console.log('Inserindo código 2FA e finalizando autenticação...');
	await page.type('input[name="otc"]', token2FA);
	await page.click('input[type="submit"]');

	// Fluxo Microsoft: Manter conectado? (Ignora erro se a tela não aparecer)
	try {
		await page.waitForSelector('input[id="idSIButton9"]', {
			visible: true,
			timeout: 3000,
		});
		await page.click('input[id="idSIButton9"]');
	} catch (e) {}

	console.log('Autenticação concluída, aguardando redirecionamento para o Deskbee...');
	// Aguarda o retorno ao Deskbee e a interceptação do token
	while (!token) {
		await new Promise((r) => setTimeout(r, 500));
	}
	console.log('Fechando navegador...');
	await browser.close();
	return token;
}

module.exports = {
	post,
	get,
	deleteRequest,
	getAuthToken,
};
