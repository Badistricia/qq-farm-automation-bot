const nodemailer = require('nodemailer');

/**
 * 发送 SMTP 邮件
 * @param {object} payload
 * @param {string} payload.smtpHost SMTP 服务器地址
 * @param {number} payload.smtpPort SMTP 端口
 * @param {string} payload.smtpUser SMTP 邮箱账号
 * @param {string} payload.smtpPass SMTP 密码/授权码
 * @param {string} payload.toEmail 接收端邮箱
 * @param {boolean} payload.smtpSecure 是否启用 SSL/TLS
 * @param {string} payload.title 邮件标题
 * @param {string} payload.content 邮件正文
 * @returns {Promise<{ok: boolean, code: string, msg: string, raw: any}>} 发送结果
 */
async function sendSmtpEmail(payload = {}) {
    const host = String(payload.smtpHost || '').trim();
    const port = Number(payload.smtpPort) || 465;
    const user = String(payload.smtpUser || '').trim();
    const pass = String(payload.smtpPass || '').trim();
    const to = String(payload.toEmail || '').trim();
    const secure = payload.smtpSecure !== false;
    const title = String(payload.title || '账号下线提醒').trim();
    const content = String(payload.content || '').trim();

    if (!host || !user || !pass || !to) {
        return {
            ok: false,
            code: 'invalid_params',
            msg: 'SMTP 配置不完整：服务器、账号、密码及接收邮箱为必填项。',
        };
    }

    try {
        const transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass,
            },
        });

        const mailOptions = {
            from: user,
            to,
            subject: title,
            text: content,
        };

        const info = await transporter.sendMail(mailOptions);

        return {
            ok: true,
            code: 'ok',
            msg: '邮件发送成功',
            raw: info,
        };
    } catch (error) {
        return {
            ok: false,
            code: 'error',
            msg: `邮件发送失败: ${error.message}`,
            raw: error,
        };
    }
}

module.exports = {
    sendSmtpEmail,
};
