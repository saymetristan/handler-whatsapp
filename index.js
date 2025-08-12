const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
const multer = require('multer');
const FormData = require('form-data');
const mime = require('mime-types');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;

// Middleware para procesar JSON
app.use(bodyParser.json());

// Variables de entorno necesarias
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_STATUS_URL = process.env.N8N_WEBHOOK_STATUS_URL;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const BUSINESS_ACCOUNT_ID = process.env.BUSINESS_ACCOUNT_ID;

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
        
        console.log(`📊 Status recibido: ${status.id} - ${status.status} para ${status.recipient_id}`);
        console.log(`🔗 N8N_WEBHOOK_STATUS_URL configurada: ${N8N_WEBHOOK_STATUS_URL ? 'SÍ' : 'NO'}`);
        
        // Enviar status a n8n (solo si tenemos la URL configurada)
        if (N8N_WEBHOOK_STATUS_URL) {
          try {
            console.log(`🚀 Enviando status a n8n: ${N8N_WEBHOOK_STATUS_URL}`);
            console.log(`📦 Datos a enviar:`, JSON.stringify(statusData, null, 2));
            
            const response = await axios.post(N8N_WEBHOOK_STATUS_URL, statusData, {
              timeout: 10000, // 10 segundos de timeout
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Handler/1.0'
              }
            });
            
            console.log(`✅ Status enviado exitosamente a n8n: ${status.id} - ${status.status}`);
            console.log(`📈 Respuesta de n8n:`, response.status, response.statusText);
            console.log(`📋 Headers de respuesta:`, response.headers);
            
          } catch (error) {
            console.error(`❌ Error al enviar status a n8n:`, {
              messageId: status.id,
              status: status.status,
              webhookUrl: N8N_WEBHOOK_STATUS_URL,
              error: error.message,
              response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
              } : 'No response',
              stack: error.stack
            });
            
            // No relanzamos el error para que no afecte el flujo principal
            // pero sí lo registramos para debugging
          }
        } else {
          console.log(`⚠️ Status recibido pero N8N_WEBHOOK_STATUS_URL no configurada: ${status.id} - ${status.status}`);
          console.log(`🔧 Variables de entorno disponibles:`, {
            N8N_WEBHOOK_URL: N8N_WEBHOOK_URL ? 'CONFIGURADA' : 'NO CONFIGURADA',
            N8N_WEBHOOK_STATUS_URL: N8N_WEBHOOK_STATUS_URL ? 'CONFIGURADA' : 'NO CONFIGURADA',
            WHATSAPP_TOKEN: WHATSAPP_TOKEN ? 'CONFIGURADA' : 'NO CONFIGURADA',
            PHONE_NUMBER_ID: PHONE_NUMBER_ID ? 'CONFIGURADA' : 'NO CONFIGURADA'
          });
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
    
    // Normalización y validación para audio/voice
    if (requestBody.type === 'audio' && requestBody.audio) {
      const audioPayload = requestBody.audio;
      if (typeof audioPayload.voice === 'string') {
        const v = audioPayload.voice.trim().toLowerCase();
        audioPayload.voice = v === 'true' || v === '1' || v === 'yes';
      }
      if (audioPayload.voice === true && audioPayload.id && WHATSAPP_TOKEN) {
        try {
          // Verificar que el media es OGG/Opus para voice notes
          const meta = await axios.get(
            `https://graph.facebook.com/v18.0/${audioPayload.id}`,
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
          );
          const mimeType = meta.data?.mime_type || '';
          const isOgg = typeof mimeType === 'string' && mimeType.toLowerCase().includes('ogg');
          if (!isOgg) {
            console.warn(`audio.voice=true pero MIME no OGG (${mimeType}). Forzando voice=false para evitar no reproducible.`);
            audioPayload.voice = false;
          }
        } catch (e) {
          console.warn('No se pudo verificar MIME del audio para voice; se envía sin voice:', e.response?.data || e.message);
          // Para evitar mensajes no reproducibles, degradamos a audio normal si no hay confirmación
          audioPayload.voice = false;
        }
      }
      requestBody.audio = audioPayload;
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

// Subida de media (estilo WABA)
// Acepta: multipart/form-data con campo `file` (binario) o JSON { url: "https://..." }
// Respuesta: { success, data: { id, mime_type, sha256, file_size } }
app.post('/media', upload.any(), async (req, res) => {
  try {
    if (!PHONE_NUMBER_ID) {
      return res.status(400).json({ success: false, error: 'PHONE_NUMBER_ID no configurado' });
    }
    if (!WHATSAPP_TOKEN) {
      return res.status(400).json({ success: false, error: 'WHATSAPP_TOKEN no configurado' });
    }

    const graphBase = 'https://graph.facebook.com/v18.0';

    // Caso 1: subida por binario (multipart)
    const filePart = Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : undefined;
    if (filePart) {
      const detectedMime = filePart.mimetype || mime.lookup(filePart.originalname) || 'application/octet-stream';

      // Inferir tipo si no viene explícito
      let { type } = req.body || {};
      if (!type) {
        if (detectedMime.startsWith('image/')) {
          type = detectedMime === 'image/webp' ? 'image' : 'image';
        } else if (detectedMime.startsWith('audio/')) {
          type = 'audio';
        } else if (detectedMime.startsWith('video/')) {
          type = 'video';
        } else {
          type = 'document';
        }
      }

      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', type);
      form.append('file', filePart.buffer, {
        filename: filePart.originalname || 'upload',
        contentType: detectedMime
      });

      try {
        const response = await axios.post(
          `${graphBase}/${PHONE_NUMBER_ID}/media`,
          form,
          {
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${WHATSAPP_TOKEN}`
            },
            maxBodyLength: Infinity
          }
        );
        return res.status(200).json({ success: true, data: response.data });
      } catch (error) {
        const graphErr = error.response?.data || { message: error.message };
        return res.status(400).json({ success: false, error: graphErr });
      }
    }

    // Caso 2: subida por URL (JSON body)
    const { url, type: linkType } = req.body || {};
    if (url) {
      try {
        const response = await axios.post(
          `${graphBase}/${PHONE_NUMBER_ID}/media`,
          {
            messaging_product: 'whatsapp',
            link: url,
            type: linkType || undefined
          },
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        return res.status(200).json({ success: true, data: response.data });
      } catch (error) {
        const graphErr = error.response?.data || { message: error.message };
        return res.status(400).json({ success: false, error: graphErr });
      }
    }

    return res.status(400).json({ success: false, error: 'Debes enviar un archivo en campo `file` o un body con { url }' });
  } catch (error) {
    console.error('Error al subir media:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// Obtener metadata / URL de media (estandarizado)
app.get(['/media/:mediaId/metadata', '/media/:mediaId/url'], async (req, res) => {
  try {
    const { mediaId } = req.params;
    if (!mediaId) {
      return res.status(400).json({ success: false, error: 'mediaId es requerido' });
    }
    if (!WHATSAPP_TOKEN) {
      return res.status(400).json({ success: false, error: 'WHATSAPP_TOKEN no configurado' });
    }

    const response = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    return res.status(200).json({
      success: true,
      data: {
        id: mediaId,
        url: response.data.url,
        mime_type: response.data.mime_type,
        file_size: response.data.file_size,
        sha256: response.data.sha256
      }
    });
  } catch (error) {
    console.error('Error al obtener metadata de media:', error.response?.data || error.message);
    return res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// Borrar media del bucket de Meta
app.delete('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    if (!mediaId) {
      return res.status(400).json({ success: false, error: 'mediaId es requerido' });
    }
    if (!WHATSAPP_TOKEN) {
      return res.status(400).json({ success: false, error: 'WHATSAPP_TOKEN no configurado' });
    }

    const response = await axios.delete(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    return res.status(200).json({ success: true, data: response.data || { id: mediaId, deleted: true } });
  } catch (error) {
    console.error('Error al eliminar media:', error.response?.data || error.message);
    return res.status(500).json({ success: false, error: error.response?.data || error.message });
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

// Endpoint para crear una plantilla de mensaje
app.post('/create-template', async (req, res) => {
  try {
    if (!BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({ success: false, error: 'BUSINESS_ACCOUNT_ID no configurado' });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${BUSINESS_ACCOUNT_ID}/message_templates`,
      req.body,
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
    console.error('Error al crear plantilla:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Endpoint para listar plantillas
app.get('/templates', async (req, res) => {
  try {
    if (!BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({ success: false, error: 'BUSINESS_ACCOUNT_ID no configurado' });
    }

    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${BUSINESS_ACCOUNT_ID}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error al listar plantillas:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Endpoint para editar una plantilla
app.post('/edit-template/:templateId', async (req, res) => {
  try {
    if (!BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({ success: false, error: 'BUSINESS_ACCOUNT_ID no configurado' });
    }

    const { templateId } = req.params;

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${templateId}`,
      req.body,
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
    console.error('Error al editar plantilla:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Endpoint para eliminar una plantilla
app.delete('/template/:templateId', async (req, res) => {
  try {
    if (!BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({ success: false, error: 'BUSINESS_ACCOUNT_ID no configurado' });
    }

    const { templateId } = req.params;

    const response = await axios.delete(
      `https://graph.facebook.com/v17.0/${BUSINESS_ACCOUNT_ID}/message_templates/${templateId}`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error al eliminar plantilla:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Endpoint para testing de conectividad con n8n
app.get('/test-n8n', async (req, res) => {
  try {
    const testData = {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'Test de conectividad desde Railway',
      source: 'whatsapp-handler'
    };

    const results = {
      environment: {
        N8N_WEBHOOK_URL: N8N_WEBHOOK_URL ? 'CONFIGURADA' : 'NO CONFIGURADA',
        N8N_WEBHOOK_STATUS_URL: N8N_WEBHOOK_STATUS_URL ? 'CONFIGURADA' : 'NO CONFIGURADA',
        PORT: PORT
      },
      tests: {}
    };

    // Test del webhook principal de mensajes
    if (N8N_WEBHOOK_URL) {
      try {
        console.log(`🧪 Testing webhook principal: ${N8N_WEBHOOK_URL}`);
        const response = await axios.post(N8N_WEBHOOK_URL, testData, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Handler-Test/1.0'
          }
        });
        results.tests.mainWebhook = {
          status: 'SUCCESS',
          responseStatus: response.status,
          responseTime: 'OK',
          url: N8N_WEBHOOK_URL
        };
        console.log(`✅ Test exitoso en webhook principal`);
      } catch (error) {
        results.tests.mainWebhook = {
          status: 'ERROR',
          error: error.message,
          url: N8N_WEBHOOK_URL,
          details: error.response ? {
            status: error.response.status,
            data: error.response.data
          } : 'No response'
        };
        console.log(`❌ Test fallido en webhook principal:`, error.message);
      }
    } else {
      results.tests.mainWebhook = {
        status: 'NOT_CONFIGURED',
        message: 'N8N_WEBHOOK_URL no está configurada'
      };
    }

    // Test del webhook de status
    if (N8N_WEBHOOK_STATUS_URL) {
      try {
        console.log(`🧪 Testing webhook de status: ${N8N_WEBHOOK_STATUS_URL}`);
        const statusTestData = {
          ...testData,
          messageId: 'test-message-id',
          recipientId: '+1234567890',
          status: 'delivered'
        };
        
        const response = await axios.post(N8N_WEBHOOK_STATUS_URL, statusTestData, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Handler-Test/1.0'
          }
        });
        results.tests.statusWebhook = {
          status: 'SUCCESS',
          responseStatus: response.status,
          responseTime: 'OK',
          url: N8N_WEBHOOK_STATUS_URL
        };
        console.log(`✅ Test exitoso en webhook de status`);
      } catch (error) {
        results.tests.statusWebhook = {
          status: 'ERROR',
          error: error.message,
          url: N8N_WEBHOOK_STATUS_URL,
          details: error.response ? {
            status: error.response.status,
            data: error.response.data
          } : 'No response'
        };
        console.log(`❌ Test fallido en webhook de status:`, error.message);
      }
    } else {
      results.tests.statusWebhook = {
        status: 'NOT_CONFIGURED',
        message: 'N8N_WEBHOOK_STATUS_URL no está configurada'
      };
    }

    res.json({
      success: true,
      testTimestamp: new Date().toISOString(),
      results
    });

  } catch (error) {
    console.error('Error en test de n8n:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      testTimestamp: new Date().toISOString()
    });
  }
});

// Endpoint para obtener info del phone number ID
app.get('/phone-info', async (req, res) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );
    
    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error al obtener info del phone number:', error.response?.data || error.message);
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