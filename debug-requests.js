// Script de diagnóstico para detectar requests duplicados
const express = require('express');
const app = express();

app.use(express.json());

// Contador de requests por minuto
let requestCounts = {};
let messageIds = new Set();

app.post('/webhook', (req, res) => {
  const now = new Date();
  const minute = now.getMinutes();
  const messageId = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id;
  
  // Contar requests por minuto
  requestCounts[minute] = (requestCounts[minute] || 0) + 1;
  
  // Detectar mensajes duplicados
  if (messageId) {
    if (messageIds.has(messageId)) {
      console.log(`🔁 DUPLICADO detectado: ${messageId}`);
    } else {
      messageIds.add(messageId);
    }
  }
  
  console.log(`📊 Requests en minuto ${minute}: ${requestCounts[minute]}`);
  console.log(`🆔 MessageID: ${messageId || 'N/A'}`);
  console.log(`📱 User-Agent: ${req.headers['user-agent']}`);
  console.log(`🌐 IP: ${req.ip || req.connection.remoteAddress}`);
  console.log('---');
  
  res.status(200).send('EVENT_RECEIVED');
});

app.listen(3001, () => {
  console.log('🔍 Diagnóstico corriendo en puerto 3001');
  console.log('📊 Monitoring requests duplicados...');
});
