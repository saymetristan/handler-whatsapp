# Guía de Debugging: Status no llega a n8n desde Railway

## Problema
Railway muestra que se está enviando el status pero n8n no lo recibe.

## Pasos de Diagnóstico

### 1. Verificar Variables de Entorno en Railway

Asegúrate de que tienes configuradas estas variables de entorno en Railway:

```
N8N_WEBHOOK_URL=https://tu-n8n.com/webhook/mensajes
N8N_WEBHOOK_STATUS_URL=https://tu-n8n.com/webhook/status
WHATSAPP_TOKEN=tu_token_de_whatsapp
PHONE_NUMBER_ID=tu_phone_number_id
VERIFY_TOKEN=tu_verify_token
```

**⚠️ IMPORTANTE**: `N8N_WEBHOOK_STATUS_URL` debe ser diferente a `N8N_WEBHOOK_URL`

### 2. Probar Conectividad

Haz una petición GET a tu aplicación en Railway:

```
https://tu-app.railway.app/test-n8n
```

Esto te dará información detallada sobre:
- ✅ Si las variables están configuradas
- ✅ Si n8n responde correctamente
- ❌ Errores de conectividad específicos

### 3. Revisar Logs Detallados en Railway

Con el código actualizado, ahora verás logs más detallados:

#### Logs Exitosos:
```
📊 Status recibido: wamid.xxx - delivered para +1234567890
🔗 N8N_WEBHOOK_STATUS_URL configurada: SÍ
🚀 Enviando status a n8n: https://tu-n8n.com/webhook/status
📦 Datos a enviar: { "messageId": "wamid.xxx", ... }
✅ Status enviado exitosamente a n8n: wamid.xxx - delivered
📈 Respuesta de n8n: 200 OK
```

#### Logs de Error:
```
❌ Error al enviar status a n8n: {
  "messageId": "wamid.xxx",
  "webhookUrl": "https://tu-n8n.com/webhook/status",
  "error": "timeout of 10000ms exceeded",
  "response": { "status": 500, "data": "..." }
}
```

#### Variables no configuradas:
```
⚠️ Status recibido pero N8N_WEBHOOK_STATUS_URL no configurada
🔧 Variables de entorno disponibles: {
  "N8N_WEBHOOK_URL": "CONFIGURADA",
  "N8N_WEBHOOK_STATUS_URL": "NO CONFIGURADA"
}
```

### 4. Verificar Configuración de n8n

#### 4.1 Webhook de Status en n8n

1. Crea un nuevo workflow en n8n
2. Añade un nodo **Webhook**
3. Configura:
   - **HTTP Method**: POST
   - **Path**: `/webhook/status` (o lo que tengas configurado)
   - **Response Mode**: Respond Immediately
4. Copia la URL del webhook y úsala como `N8N_WEBHOOK_STATUS_URL`

#### 4.2 Estructura de Datos que Recibe n8n

El webhook de status recibe esta estructura:

```json
{
  "messageId": "wamid.HBgLMTU...",
  "recipientId": "+1234567890",
  "status": "delivered",
  "timestamp": "1703123456",
  "conversation": { "id": "...", "origin": { "type": "business_initiated" } },
  "pricing": { "billable": true, "pricing_model": "CBP", "category": "business_initiated" },
  "errors": null,
  "raw": { ... }
}
```

### 5. Problemas Comunes y Soluciones

#### 5.1 URL Incorrecta
**Síntoma**: Error 404 en logs
**Solución**: Verifica que la URL de n8n sea exacta (incluye el path `/webhook/status`)

#### 5.2 n8n no Responde
**Síntoma**: Timeout o connection refused
**Solución**: 
- Verifica que n8n esté activo
- Revisa el firewall de n8n
- Confirma que la URL sea accesible desde internet

#### 5.3 n8n Rechaza la Petición
**Síntoma**: Error 400, 401, 403
**Solución**:
- Verifica autenticación si es requerida
- Revisa configuración del webhook en n8n
- Confirma que el Content-Type sea application/json

#### 5.4 Webhook Desactivado
**Síntoma**: Status SUCCESS en test pero workflow no se ejecuta
**Solución**:
- Activa el workflow en n8n
- Verifica que el webhook esté "Listening"

### 6. Testing Manual

#### 6.1 Test desde Railway
```bash
curl https://tu-app.railway.app/test-n8n
```

#### 6.2 Test directo a n8n
```bash
curl -X POST https://tu-n8n.com/webhook/status \
  -H "Content-Type: application/json" \
  -d '{
    "test": true,
    "messageId": "test-123",
    "recipientId": "+1234567890",
    "status": "delivered"
  }'
```

### 7. Monitoreo Continuo

Para monitorear en tiempo real, revisa los logs de Railway:

```bash
# Si usas Railway CLI
railway logs --follow
```

O desde el dashboard de Railway en la sección "Deployments" > "Logs"

## Checklist Final

- [ ] Variables de entorno configuradas en Railway
- [ ] `N8N_WEBHOOK_STATUS_URL` diferente a `N8N_WEBHOOK_URL`
- [ ] Webhook de status activo en n8n
- [ ] Test de conectividad exitoso (`/test-n8n`)
- [ ] Logs muestran envío exitoso a n8n
- [ ] Workflow de n8n se ejecuta al recibir status 