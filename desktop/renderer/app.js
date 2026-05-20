const API_URL = 'http://localhost:8080/api/events';

async function cargarEventos() {
  try {
    const res = await fetch(API_URL);
    const eventos = await res.json();
    const lista = document.getElementById('lista-eventos');
    lista.innerHTML = '';

    if (eventos.length === 0) {
      lista.innerHTML = '<p style="color:#6b7280;text-align:center">No hay eventos todavía.</p>';
      return;
    }

    eventos.forEach(evento => {
      const div = document.createElement('div');
      div.style.cssText = 'background:#f8faff;border:1px solid #e8e9f3;border-radius:16px;padding:12px;margin-bottom:10px';
      div.innerHTML = `
        <strong>${evento.title}</strong>
        <div style="color:#6b7280;font-size:13px;margin-top:4px">${evento.startAt ? new Date(evento.startAt).toLocaleString('es-ES') : ''}</div>
        ${evento.description ? `<div style="margin-top:6px;font-size:13px">${evento.description}</div>` : ''}
      `;
      lista.appendChild(div);
    });
  } catch (e) {
    const lista = document.getElementById('lista-eventos');
    lista.innerHTML = '<p style="color:#ef4444">Backend no disponible. Arranca Spring Boot.</p>';
  }
}

async function crearEvento(e) {
  e.preventDefault();
  const title = document.getElementById('titulo').value;
  const description = document.getElementById('descripcion').value;
  const startAt = document.getElementById('inicio').value;
  const endAt = document.getElementById('fin').value;

  await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, startAt, endAt })
  });

  e.target.reset();
  cargarEventos();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-evento').addEventListener('submit', crearEvento);
  cargarEventos();
});