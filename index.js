const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para procesar JSON
app.use(bodyParser.json());

// Variables de entorno necesarias
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Endpoint para la verificación del webhook (GET)
app.get('/webhook', (req, res) => {
  // Parámetros que envía Meta al hacer la verificación
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verificar que tengamos los parámetros correctos
  if (mode && token) {
    // Comprobar que el token coincide con nuestro verify token
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado con éxito!');
      res.status(200).send(challenge);
    } else {
      // Token no válido
      res.sendStatus(403);
    }
  } else {
    // Parámetros incorrectos
    res.sendStatus(400);
  }
});

// Endpoint para recibir mensajes de WhatsApp (POST)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Verificar que es un evento de WhatsApp
    if (body.object && body.entry && 
        body.entry[0].changes && 
        body.entry[0].changes[0].value.messages) {
      
      // Extraer información del mensaje entrante
      const messageData = body.entry[0].changes[0].value;
      const message = messageData.messages[0];
      const from = message.from;
      const messageId = message.id;
      
      let messageContent;
      let messageType;
      
      // Determinar el tipo de mensaje
      if (message.type === 'text') {
        messageType = 'text';
        messageContent = message.text.body;
      } else if (message.type === 'image') {
        messageType = 'image';
        messageContent = message.image.id;
      } else if (message.type === 'audio') {
        messageType = 'audio';
        messageContent = message.audio.id;
      } else if (message.type === 'document') {
        messageType = 'document';
        messageContent = message.document.id;
      } else {
        messageType = message.type;
        messageContent = 'Contenido no procesable';
      }
      
      // Preparar los datos para enviar a n8n
      const webhookData = {
        messageId,
        from,
        type: messageType,
        content: messageContent,
        timestamp: message.timestamp,
        contextFrom: messageData.contacts[0],
        raw: messageData
      };
      
      // Enviar los datos a n8n
      await axios.post(N8N_WEBHOOK_URL, webhookData);
      
      console.log(`Mensaje procesado y enviado a n8n: ${messageId}`);
      
      // Responder a Meta para confirmar recepción
      res.status(200).send('EVENT_RECEIVED');
    } else {
      // No es un evento de mensaje
      res.status(200).send('EVENT_RECEIVED');
    }
  } catch (error) {
    console.error('Error al procesar el webhook:', error);
    res.status(500).send('Error al procesar el webhook');
  }
});

// Endpoint para enviar mensajes a través de la API de WhatsApp
app.post('/send-message', async (req, res) => {
  try {
    const { to, message, type = 'text' } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren los campos "to" y "message"'
      });
    }
    
    let requestBody;
    
    // Preparar body según el tipo de mensaje
    if (type === 'text') {
      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          body: message
        }
      };
    } else if (type === 'template') {
      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: message
      };
    } else {
      return res.status(400).json({
        success: false,
        error: 'Tipo de mensaje no soportado'
      });
    }
    
    // Enviar mensaje a la API de WhatsApp
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error al enviar mensaje:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 