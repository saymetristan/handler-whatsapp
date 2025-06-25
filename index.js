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
const N8N_WEBHOOK_STATUS_URL = process.env.N8N_WEBHOOK_STATUS_URL;
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
    if (body.object && body.entry && body.entry[0].changes) {
      const changeData = body.entry[0].changes[0].value;
      
      // MANEJO DE MENSAJES ENTRANTES
      if (changeData.messages && changeData.messages.length > 0) {
        const message = changeData.messages[0];
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
        
        // Preparar los datos para enviar a n8n (mensajes)
        const webhookData = {
          messageId,
          from,
          type: messageType,
          content: messageContent,
          timestamp: message.timestamp,
          contextFrom: changeData.contacts[0],
          raw: changeData
        };
        
        // Enviar los datos a n8n (mensajes)
        await axios.post(N8N_WEBHOOK_URL, webhookData);
        
        console.log(`Mensaje procesado y enviado a n8n: ${messageId}`);
      }
      
      // MANEJO DE STATUS DE MENSAJES
      if (changeData.statuses && changeData.statuses.length > 0) {
        const status = changeData.statuses[0];
        
        // Preparar los datos del status para enviar a n8n
        const statusData = {
          messageId: status.id,
          recipientId: status.recipient_id,
          status: status.status, // sent, delivered, read, failed
          timestamp: status.timestamp,
          conversation: status.conversation || null,
          pricing: status.pricing || null,
          errors: status.errors || null,
          raw: changeData
        };
        
        // Enviar status a n8n (solo si tenemos la URL configurada)
        if (N8N_WEBHOOK_STATUS_URL) {
          await axios.post(N8N_WEBHOOK_STATUS_URL, statusData);
          console.log(`Status de mensaje enviado a n8n: ${status.id} - ${status.status}`);
        } else {
          console.log(`Status recibido pero N8N_WEBHOOK_STATUS_URL no configurada: ${status.id} - ${status.status}`);
        }
      }
      
      // Responder a Meta para confirmar recepción
      res.status(200).send('EVENT_RECEIVED');
    } else {
      // No es un evento válido
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
    const requestBody = req.body;
    
    // Asegurarse de que siempre tenga el messaging_product correcto
    if (!requestBody.messaging_product) {
      requestBody.messaging_product = 'whatsapp';
    }
    
    // Si se proporciona recipient_phone_number pero no to, usamos ese valor
    if (!requestBody.to && requestBody.recipient_phone_number) {
      requestBody.to = requestBody.recipient_phone_number;
      delete requestBody.recipient_phone_number; // Eliminamos el campo no estándar
    }
    
    // Enviar mensaje a la API de WhatsApp, pasando el body tal como viene
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

// Endpoint para obtener URL de descarga de medios
app.get('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    
    if (!mediaId) {
      return res.status(400).json({
        success: false,
        error: 'mediaId es requerido'
      });
    }

    // Obtener información del media de WhatsApp API
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

    const mediaData = response.data;
    
    // Obtener la URL de descarga del archivo
    const downloadResponse = await axios.get(mediaData.url, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      },
      responseType: 'stream',
      maxRedirects: 0,
      validateStatus: status => status < 400
    });

    // Si es un redirect, devolvemos la URL directa
    if (downloadResponse.status >= 300 && downloadResponse.status < 400) {
      return res.json({
        success: true,
        data: {
          mediaId,
          downloadUrl: downloadResponse.headers.location,
          mimeType: mediaData.mime_type,
          fileSize: mediaData.file_size,
          sha256: mediaData.sha256
        }
      });
    }

    // Si no es redirect, configuramos la respuesta para stream directo
    res.set({
      'Content-Type': mediaData.mime_type,
      'Content-Length': mediaData.file_size,
      'Content-Disposition': `attachment; filename="${mediaId}"`
    });

    downloadResponse.data.pipe(res);

  } catch (error) {
    console.error('Error al obtener media:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Endpoint para obtener solo la URL de descarga (sin descargar)
app.get('/media-url/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    
    if (!mediaId) {
      return res.status(400).json({
        success: false,
        error: 'mediaId es requerido'
      });
    }

    // Obtener información del media
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

    res.json({
      success: true,
      data: {
        mediaId,
        url: response.data.url,
        mimeType: response.data.mime_type,
        fileSize: response.data.file_size,
        sha256: response.data.sha256
      }
    });

  } catch (error) {
    console.error('Error al obtener URL de media:', error.response?.data || error.message);
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