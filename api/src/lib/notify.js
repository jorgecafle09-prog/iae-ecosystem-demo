'use strict';
// Automatic emails after each registration, via Azure Communication Services Email.
// Off until these app settings exist in the Static Web App:
//   ACS_CONNECTION_STRING   connection string of the Communication Services resource
//   MAIL_FROM               verified sender, e.g. DoNotReply@<your-domain>.azurecomm.net
//   OWNER_EMAILS            JSON, e.g. {"NAVES":"lucia@iae.edu","WISE":"victoria@iae.edu","Open Innovation":"victoria@iae.edu","IAE Hackathon":"lucia@iae.edu","Community":"lucia@iae.edu"}
//   HUB_URL                 optional, link used in the team email (default: relative to the site)

const REPLY_DAYS = { 'NAVES': null, 'WISE': 5, 'Open Innovation': 5, 'IAE Hackathon': 3, 'Community': 3 };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildMessages({ person, submission }, env = process.env) {
  const owners = (() => { try { return JSON.parse(env.OWNER_EMAILS || '{}'); } catch (e) { return {}; } })();
  const first = (submission.name || person.name || '').split(' ')[0] || 'hola';
  const days = REPLY_DAYS[submission.program];
  const isApp = submission.type === 'naves_application';
  const msgs = [];
  msgs.push({
    to: submission.email,
    subject: (isApp ? 'Recibimos tu postulación a NAVES' : 'Recibimos tu mensaje para ' + submission.program) + ' · ' + submission.submissionId,
    text: [
      'Hola ' + first + ',',
      '',
      isApp ? 'Recibimos tu postulación a NAVES Argentina. Te avisaremos cada cambio de estado.' : 'Recibimos tu mensaje sobre ' + submission.program + '.' + (days ? ' Te responderemos dentro de ' + days + ' días hábiles.' : ''),
      '',
      'Tu ID de emprendedor: ' + person.personId,
      'Número de ' + (isApp ? 'postulación' : 'solicitud') + ': ' + submission.submissionId,
      '',
      'Guardá estos números: con ellos te identificamos en todos los programas de EmprendeIAE.',
      '',
      'Equipo EmprendeIAE · IAE Business School, Universidad Austral'
    ].join('\n')
  });
  if (owners[submission.program]) {
    const hub = (env.HUB_URL || '').replace(/\/$/, '');
    msgs.push({
      to: owners[submission.program],
      subject: 'Nuevo ' + (isApp ? 'postulante NAVES' : 'contacto ' + submission.program) + ': ' + (submission.venture || submission.name) + ' · ' + submission.submissionId,
      text: [
        (submission.name || 'Alguien') + ' (' + submission.email + ') envió un formulario.',
        '',
        'Programa: ' + submission.program,
        'Emprendimiento: ' + (submission.venture || '—'),
        'ID de persona: ' + person.personId + (person.source === 'NAVES 2025 file' ? ' (ya estaba en NAVES 2025)' : ''),
        'Solicitud: ' + submission.submissionId,
        days ? 'Responder antes de ' + days + ' días hábiles.' : '',
        '',
        'Ver en el Hub: ' + (hub || '') + '/?view=admin'
      ].filter(x => x !== null).join('\n')
    });
  }
  return msgs.map(m => Object.assign(m, { html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#101828">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' }));
}

function makeNotifier(env = process.env) {
  if (!env.ACS_CONNECTION_STRING || !env.MAIL_FROM) return null; // emails off
  const { EmailClient } = require('@azure/communication-email');
  const client = new EmailClient(env.ACS_CONNECTION_STRING);
  return async (event) => {
    for (const m of buildMessages(event, env)) {
      await client.beginSend({ senderAddress: env.MAIL_FROM, content: { subject: m.subject, plainText: m.text, html: m.html }, recipients: { to: [{ address: m.to }] } });
    }
  };
}

module.exports = { makeNotifier, buildMessages };
