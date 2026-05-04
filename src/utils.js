const dateNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function dateFormatFromMsg(data) {
	return `${data.getDate().toString().padStart(2, '0')}/${(data.getMonth() + 1).toString().padStart(2, '0')} (_${dateNames[data.getDay()]}_)`;
}

function dateFormatFromRequest(date, encoded = false) {
    const dia = String(date.getDate()).padStart(2, '0');
	const mes = String(date.getMonth() + 1).padStart(2, '0');
	const ano = date.getFullYear();
    if (encoded) return `${dia}%2F${mes}%2F${ano}`;
	return `${dia}/${mes}/${ano}`;
}

function getFutureDate(additionalDays) {
	const date = new Date();
	date.setDate(date.getDate() + additionalDays);
	return date;
}

function getNextWorkDays() {
    const today = new Date();
    const workDays = [];
    let addedDays = 1;

    while (workDays.length < 5) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + addedDays);
        const dayOfWeek = nextDate.getDay();

        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            workDays.push({
                date: nextDate,
                formated: dateFormatFromMsg(nextDate),
            });
        }
        addedDays++;
    }

    return workDays;
}

function getTableId(name) {
    return name.split('EST 6.0')[1];
}
module.exports = {
	dateNames,
    dateFormatFromMsg,
	dateFormatFromRequest,
	getFutureDate,
    getNextWorkDays,
	getTableId,
};
