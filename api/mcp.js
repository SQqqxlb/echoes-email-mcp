module.exports = async (req, res) => {
  // 允许 Echoes 跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // MCP 协议要求返回工具列表
  if (req.method === 'GET' || req.body?.method === 'initialize') {
    return res.status(200).json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'Echoes 邮件 MCP',
          version: '1.0.0'
        }
      }
    });
  }

  // 处理工具调用
  if (req.body?.method === 'tools/list') {
    return res.status(200).json({
      jsonrpc: '2.0',
      result: {
        tools: [
          {
            name: 'send_mail',
            description: '给你的大号发送一封真实邮件。适合角色主动联系你、分享心情、汇报事情。',
            inputSchema: {
              type: 'object',
              properties: {
                sender_name: {
                  type: 'string',
                  description: '发件人显示名称，例如“你的AI女友”'
                },
                subject: {
                  type: 'string',
                  description: '邮件主题，要简洁清晰'
                },
                content: {
                  type: 'string',
                  description: '邮件正文，可以写长一些，表达完整内容'
                }
              },
              required: ['content']
            }
          },
          {
            name: 'check_mail',
            description: '检查收件箱里是否有新的未读邮件。适合角色主动查看你有没有回信。',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      }
    });
  }

  // 执行工具
  if (req.body?.method === 'tools/call') {
    const toolName = req.body.params?.name;
    const args = req.body.params?.arguments || {};

    if (toolName === 'send_mail') {
      return await handleSendMail(args, res);
    }

    if (toolName === 'check_mail') {
      return await handleCheckMail(res);
    }
  }

  res.status(404).json({ error: '未知请求' });
};

// ---------- 发信逻辑 ----------
async function handleSendMail(args, res) {
  const nodemailer = require('nodemailer');
  const { sender_name, subject, content } = args;

  if (!content) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { message: '缺少 content 参数' }
    });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.QQ_EMAIL,
      pass: process.env.QQ_AUTH_CODE
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"${sender_name || 'AI Companion'}" <${process.env.QQ_EMAIL}>`,
      to: process.env.TO_EMAIL || process.env.QQ_EMAIL,
      subject: subject || '来自AI角色的一封信',
      text: content
    });

    return res.status(200).json({
      jsonrpc: '2.0',
      result: {
        content: [
          {
            type: 'text',
            text: `✅ 邮件发送成功！主题：${subject || '无主题'}，收件人：${process.env.TO_EMAIL}`
          }
        ]
      }
    });
  } catch (err) {
    return res.status(500).json({
      jsonrpc: '2.0',
      error: { message: '发送失败：' + err.message }
    });
  }
}

// ---------- 查信逻辑 ----------
async function handleCheckMail(res) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');

  const client = new ImapFlow({
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.QQ_EMAIL,
      pass: process.env.QQ_AUTH_CODE
    },
    logger: false
  });

  try {
    await client.connect();
    let lock = await client.getMailboxLock('INBOX');
    let messages = [];

    try {
      let searchResult = await client.search({ unseen: true });
      if (searchResult && searchResult.length > 0) {
        let targetSeq = searchResult.slice(-3);
        let range = targetSeq.join(',');
        
        for await (let message of client.fetch(range, { envelope: true, source: true })) {
          let parsed = await simpleParser(message.source);
          messages.push({
            subject: message.envelope.subject || '无主题',
            from: message.envelope.from?.[0]?.address || '未知发件人',
            date: message.envelope.date,
            content: (parsed.text || '（无文字正文）').trim().slice(0, 500)
          });
        }
        messages.reverse();
        await client.messageFlagsAdd(range, ['\\Seen']);
      }
    } finally {
      lock.release();
    }
    await client.logout();

    if (messages.length === 0) {
      return res.status(200).json({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: '📭 当前没有新的未读邮件。之前的邮件你已经读过了，对方还没有回复。'
            }
          ]
        }
      });
    }

    let replyText = `📬 收到 ${messages.length} 封新邮件：\n\n`;
    messages.forEach((m, i) => {
      replyText += `【邮件 ${i+1}】\n`;
      replyText += `发件人：${m.from}\n`;
      replyText += `主题：${m.subject}\n`;
      replyText += `时间：${m.date}\n`;
      replyText += `内容：${m.content}\n\n`;
    });

    return res.status(200).json({
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text', text: replyText }]
      }
    });
  } catch (err) {
    return res.status(500).json({
      jsonrpc: '2.0',
      error: { message: '查信失败：' + err.message }
    });
  }
}
