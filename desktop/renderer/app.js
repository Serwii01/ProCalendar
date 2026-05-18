const API_URL = 'http://localhost:8080/api/events';

async function cargarEventos() {
  const res = await fetch(API_URL);
  const eventos = await res.json();

  const lista = document.getElementById('lista-eventos');
  lista.innerHTML = '';

  if (eventos.length === 0) {
    lista.innerHTML = '<p>No hay eventos todavía.</p>';
    return;
  }

  eventos.forEach(evento => {
    const li = document.createElement('li');
    li.textContent = `${evento.title} - ${evento.startAt ?? ''}`;
    lista.appendChild(li);
  });
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