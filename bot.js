const { Telegraf } = require('telegraf');
require('dotenv').config();
const Bottleneck = require('bottleneck');
const mysql = require('mysql2');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuración de Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Configuración del bot de Telegram
const bot = new Telegraf(process.env.BOT_TOKEN);
const limiter = new Bottleneck({ minTime: 2000 }); // Limitador de 2 segundos

const userSessions = {}; // Controla el estado de la sesión de IA para cada usuario

// Configuración de la base de datos
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

db.connect((err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('Conectado a la base de datos MySQL');
});

// Verificar si un usuario ya existe en la base de datos
const checkUserExists = (id_chat, callback) => {
    db.query('SELECT * FROM usuario WHERE id_chat = ?', [id_chat], (err, results) => {
        if (err) {
            console.error('Error consultando la base de datos:', err);
            return callback(err, null);
        }
        callback(null, results.length > 0);
    });
};

// Middleware para registrar comandos del bot
bot.use((ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        db.query('INSERT INTO comando_bot (comando, id_chat) VALUES (?, ?)', [ctx.message.text, ctx.chat.id], (err) => {
            if (err) {
                console.error('Error insertando comando del bot:', err);
            }
        });
    }
    return next();
});

// Comando /start
bot.start((ctx) => {
    const user = ctx.from;
    const chat = ctx.chat;

    checkUserExists(chat.id, (err, exists) => {
        if (err) {
            return ctx.reply('Hubo un problema al verificar el usuario en la base de datos.');
        }

        if (exists) {
            ctx.reply(`Oh!!!\n ¡Eres tú de nuevo, ${ctx.from.first_name}!\n Me gusta saludarte otra vez, ¿en qué puedo ayudarte?`);
        } else {
            db.query('INSERT INTO usuario (nombre, nombre_usuario, id_chat) VALUES (?, ?, ?)', [user.first_name, user.username, chat.id], (err, results) => {
                if (err) {
                    console.error('Error insertando usuario:', err);
                    return;
                }
                console.log('Usuario insertado con ID:', results.insertId);
                ctx.reply('Hola! \nUn gusto hablar contigo hoy.');
            });
        }

        // Iniciar sesión de usuario
        db.query('INSERT INTO sesion_usuario (id_chat) VALUES (?)', [chat.id], (err) => {
            if (err) {
                console.error('Error insertando sesión de usuario:', err);
            }
        });
    });
});

// Comando de ayuda
bot.command(['help', 'ayuda', 'Help', 'Ayuda'], (ctx) => {
    ctx.reply(`Aquí tienes los comandos disponibles:
/start - Saludo inicial
/ayuda - Ver esta lista de comandos
/AI - Activar modo de consulta IA
/Exit - Salir del modo IA
fecha - Ver la fecha actual
hora - Ver la hora actual
día - Ver el día de la semana actual
saludo - Saludo personalizado
chiste - Escuchar un chiste`);
});

// Comando Exit para desactivar la sesión de IA
bot.command('Exit', (ctx) => {
    const userId = ctx.from.id;
    userSessions[userId] = { isInAIMode: false };
    ctx.reply('Modo IA desactivado. Volviendo a respuestas predeterminadas.');

    // Finalizar sesión de usuario
    db.query('UPDATE sesion_usuario SET fin = NOW() WHERE id_chat = ? AND fin IS NULL', [ctx.chat.id], (err) => {
        if (err) {
            console.error('Error actualizando sesión de usuario:', err);
        }
    });
});

// Comando AI para activar la sesión de IA
bot.command('AI', (ctx) => {
    const userId = ctx.from.id;
    userSessions[userId] = { isInAIMode: true };
    ctx.reply('Modo IA activado. Puedes empezar a hacerme preguntas.');
});

// Respuestas básicas
bot.hears(['hola', 'Hola', 'ola', 'Ola'], (ctx) => { 
    ctx.reply('Qué tal, en qué puedo ayudarte ' + ctx.from.first_name);
});
bot.hears(['buenos días', 'Buenos días', 'buenas tardes', 'Buenas tardes', 'buenas noches', 'Buenas noches'], (ctx) => {
    ctx.reply(`¡Hola ${ctx.from.first_name}! Espero que estés teniendo un gran día.`);
});
bot.hears(['gracias', 'Gracias', 'muchas gracias', 'Muchas gracias'], (ctx) => {
    ctx.reply('¡De nada! Estoy aquí para ayudar.');
});
bot.hears(['adios', 'Adios', 'chao', 'Chao', 'hasta luego', 'Hasta luego'], (ctx) => {
    ctx.reply('¡Hasta pronto! Cuídate.');
});

// Preguntar por fecha, día y hora
bot.hears(['que dia es hoy', 'Que dia es hoy', 'fecha', 'Fecha'], (ctx) => {
    const fecha = new Date().toLocaleDateString();
    ctx.reply(`Hoy es ${fecha}`);
});
bot.hears(['qué día es', 'Qué día es', 'día', 'Día'], (ctx) => {
    const opcionesDias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const diaSemana = opcionesDias[new Date().getDay()];
    ctx.reply(`Hoy es ${diaSemana}.`);
});
bot.hears(['que hora es', 'Que hora es', 'hora', 'Hora'], (ctx) => {
    const hora = new Date().toLocaleTimeString();
    ctx.reply(`La hora actual es ${hora}`);
});

// Respuestas de AI y predeterminadas
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    if (userSessions[userId] && userSessions[userId].isInAIMode) {
        try {
            const response = await model.generateContent(userMessage);
            ctx.reply(response.response.text()); // Enviar respuesta de la IA
        } catch (error) {
            console.error('Error con la IA de Gemini:', error);
            ctx.reply('Hubo un problema al procesar tu solicitud en modo IA. Inténtalo nuevamente.');
        }
    } else {
        // Respuestas predeterminadas
        if (/saludo/i.test(userMessage)) {
            ctx.reply('¡Hola! ¿Cómo puedo ayudarte?');
        } else if (/chiste/i.test(userMessage)) {
            ctx.reply('¿Por qué el libro de matemáticas estaba triste? ¡Porque tenía demasiados problemas!');
        } else {
            ctx.reply('Lo siento, no entiendo tu mensaje. Por favor, usa /ayuda para ver los comandos disponibles.');
        }
    }
});

bot.launch()
    .then(() => {
        console.log('Bot de Telegram iniciado.');
    })
    .catch((error) => {
        console.error('Error iniciando el bot de Telegram:', error);
    });

// Finalizar sesión de usuario al terminar el proceso
process.on('SIGINT', () => {
    db.query('UPDATE sesion_usuario SET fin = NOW() WHERE fin IS NULL', (err) => {
        if (err) {
            console.error('Error actualizando sesiones de usuario al finalizar:', err);
        }
        process.exit();
    });
});
