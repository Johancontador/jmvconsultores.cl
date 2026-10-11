# Restablecer la clave de un usuario (procedimiento super admin)

> Cuándo usarlo: el usuario olvidó su clave, o quedó a mitad del flujo de
> primer ingreso (cambio forzado) y la provisional ya no sirve.

## Contexto del flujo de usuario temporal (Fase A — acceso cliente)

1. El super admin crea el usuario en **Configuración → Administración**
   (`#admin`, tarjeta «Cliente con acceso exclusivo a su empresa») o vía
   `POST /api/auth/usuarios-empresa`.
2. El sistema genera una **clave provisional pronunciable** (4 sílabas +
   2 dígitos, sin 0 ni 1) y la muestra **UNA sola vez**. No queda en logs
   ni auditoría (verificado por `test/usuarios-temporales.test.js`).
3. El usuario entra con esa clave → el sistema **le obliga a cambiarla**
   (`users.debe_cambiar_clave = 1`) → tras el cambio, **vuelve al login**
   (el cambio revoca todas sus sesiones por seguridad) → entra con la
   clave nueva → onboarding con RUT + clave SII.

## Reset de clave (cuando la provisional se pierde o se olvida)

No hay endpoint voluntario para esto (es una operación de administración
directa sobre la BD del servidor). Ejecutar **en el contenedor** del VPS:

```bash
ssh johan@100.116.109.54 "docker exec iva-mensual node -e \"
const db = require('/app/backend/db');
const { hashPassword } = require('/app/backend/services/password');
const crypto = require('crypto');
const C='bcdfghjklmnpqrstvwxyz', V='aeiou';
const sil = () => C[crypto.randomInt(0,C.length)] + V[crypto.randomInt(0,V.length)];
let clave = sil()+sil()+sil()+sil()+String(crypto.randomInt(2,10))+String(crypto.randomInt(2,10));
const tx = db.transaction(() => {
  db.prepare('UPDATE users SET password_hash=?, debe_cambiar_clave=1 WHERE username=?').run(hashPassword(clave), 'CYESISTEMA');
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username=?)').run('CYESISTEMA');
});
tx();
const u = db.prepare('SELECT id, username, debe_cambiar_clave, activo FROM users WHERE username=?').get('CYESISTEMA');
console.log('OK', JSON.stringify(u));
console.log('CLAVE_PROVISIONAL=' + clave);
\""
```

Qué hace, exactamente:

- Genera una clave provisional con la **misma lógica** del sistema
  (`generarClaveProvisional`: sílabas pronunciables con `crypto.randomInt`).
- Guarda solo el **hash scrypt** — la clave en claro existe únicamente en
  la salida de este comando y en tu pantalla.
- Marca `debe_cambiar_clave=1` → el primer login fuerza el cambio.
- **Revoca todas las sesiones** del usuario (nada queda abierto).

Después del reset, darle la clave al cliente: entra, cambia la clave,
y continúa con su onboarding normal.

## Desbloqueo por rate-limit (complemento frecuente)

Cada IP tiene 5 intentos de login por ventana de 15 minutos; al agotarse
la tabla `rate_limit` (SQLite, persistente entre reinicios) bloquea con
HTTP 429 mostrando **los minutos restantes** en el mensaje (ver
`backend/core/rate-limit-db.js`, `mensajeConReintente`). Para liberar a
una IP antes de tiempo:

```bash
ssh johan@100.116.109.54 "docker exec iva-mensual node -e \"
const db = require('/app/backend/db');
const r = db.prepare('DELETE FROM rate_limit WHERE clave = ?').run('login:1.2.3.4');
console.log('entradas eliminadas:', r.changes);
\""
```

(Sustituir `login:1.2.3.4` por la IP del mensaje 429.)

## Verificación posterior (rápida)

```bash
curl -X POST https://app.jmvconsultores.cl/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"CYESISTEMA","password":"LA_CLAVE_PROVISIONAL"}'
# esperado: HTTP 200, {"ok":true, "user":{"debe_cambiar_clave":true, ...}}
```

⚠️ Un 401 con la clave recién generada significa que algo falló en el
UPDATE — repetir y revisar el nombre exacto del usuario en
`SELECT username FROM users WHERE id=N`.

## Riesgos conocidos y mitigados

- La clave provisional viaja por chat/telefono al cliente: es un token de
  primer ingreso, no una clave permanente — la vida útil es un solo login
  (el sistema la invalida al concluir el cambio).
- El reset NO toca el vínculo empresa del usuario: si ya completó su
  onboarding, conserva su empresa y permisos.
- La operación queda fuera de auditoría (es administración directa de BD):
  aplicarla solo ante solicitud del cliente o de JMV.
