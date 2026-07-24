const nodemailer = require('nodemailer');

function positiveNumber(value, label)
{
    const number = Number(value);
    if(!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero`);
    return number;
}

function normalizeQuoteRequest(input = {})
{
    const method = String(input.shippingMethod || '').trim().toUpperCase();
    if(method !== 'UCL') throw new Error('Only UCL quote requests are available right now');

    const city = String(input.city || '').trim();
    const state = String(input.state || '').trim().toUpperCase();
    const zip = String(input.zip || '').trim();
    if(!city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip))
    {
        throw new Error('Enter a city, two-letter state, and valid ZIP code');
    }

    const groups = Array.isArray(input.packages) ? input.packages : [];
    if(groups.length === 0) throw new Error('Add at least one box');

    const packages = [];
    groups.forEach((group, groupIndex)=> {
        const quantity = positiveNumber(group.quantity, `Box type ${groupIndex + 1} quantity`);
        if(!Number.isInteger(quantity) || quantity > 40) throw new Error(`Box type ${groupIndex + 1} quantity must be a whole number from 1 to 40`);
        const box = {
            weight: positiveNumber(group.weight, `Box type ${groupIndex + 1} weight`),
            length: positiveNumber(group.length, `Box type ${groupIndex + 1} length`),
            width: positiveNumber(group.width, `Box type ${groupIndex + 1} width`),
            height: positiveNumber(group.height, `Box type ${groupIndex + 1} height`),
        };
        for(let index = 0; index < quantity; index += 1) packages.push(box);
    });

    if(packages.length > 40) throw new Error('A quote request can contain at most 40 boxes');
    return {method, city, state, zip, packages};
}

function formatNumber(value)
{
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
}

function buildUclQuoteEmail(input)
{
    const request = normalizeQuoteRequest(input);
    const count = request.packages.length;
    const destination = `${request.city}, ${request.state} ${request.zip}`;
    const packageLines = request.packages.map((box)=>
        `${formatNumber(box.weight)}lbs ${formatNumber(box.length)} x ${formatNumber(box.width)} x ${formatNumber(box.height)}`
    );
    const text = [
        'Dear UCL team,',
        '',
        `Please Provide me a shipping quote for ${count} ${count === 1 ? 'box' : 'boxes'} with the following dimensions going to ${destination}:`,
        '',
        ...packageLines,
        '',
        'Thank you.',
        '',
        'Best,',
        'Abrar.',
    ].join('\n');

    return {
        ...request,
        subject: `Shipping Quote Request - ${count} ${count === 1 ? 'box' : 'boxes'} to ${destination}`,
        text,
        boxCount: count,
    };
}

function smtpConfiguration(env = process.env)
{
    const port = Number(env.SMTP_PORT || 465);
    return {
        host: env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: String(env.SMTP_SECURE || port === 465).toLowerCase() !== 'false',
        user: env.SMTP_USER || '',
        password: env.SMTP_PASSWORD || '',
        from: env.SHIPPING_QUOTE_FROM || env.SMTP_USER || '',
        to: env.UCL_QUOTE_EMAIL_TO || '',
    };
}

async function sendUclQuoteEmail(input, env = process.env)
{
    const email = buildUclQuoteEmail(input);
    const smtp = smtpConfiguration(env);
    if(!smtp.user || !smtp.password || !smtp.from || !smtp.to)
    {
        const error = new Error('Shipping quote email is not configured. Add SMTP_USER, SMTP_PASSWORD, and UCL_QUOTE_EMAIL_TO to backend/.env.');
        error.code = 'EMAIL_NOT_CONFIGURED';
        throw error;
    }

    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {user: smtp.user, pass: smtp.password},
    });
    const result = await transporter.sendMail({from: smtp.from, to: smtp.to, subject: email.subject, text: email.text});
    return {...email, messageId: result.messageId, recipient: smtp.to};
}

module.exports = {buildUclQuoteEmail, sendUclQuoteEmail, smtpConfiguration};
