const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'homecare_db',
  password: 'pamela123',
  port: 5432,
});

// Comprobar conexión
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error al conectar a PostgreSQL:', err.stack);
  }
  console.log('✅ Conexión exitosa a la base de datos PostgreSQL');
  release();
});

// 0. Autenticación / Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, rol, password_hash FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }

    const usuario = result.rows[0];

    if (usuario.password_hash !== password) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }

    const { password_hash, ...datosUsuario } = usuario;
    res.json({ message: 'Autenticación exitosa', usuario: datosUsuario });
  } catch (err) {
    console.error('Error en POST /api/login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 1. Obtener citas con datos del paciente
app.get('/api/citas', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id,
        p.nombre AS paciente,
        p.documento_id,
        p.telefono,
        p.direccion,
        c.sintomas_iniciales,
        c.prioridad,
        c.estado
      FROM citas_visitas c
      INNER JOIN pacientes p ON c.paciente_id = p.id
      ORDER BY c.id DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /api/citas:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Crear nueva cita
app.post('/api/citas', async (req, res) => {
  const { documento_id, paciente, telefono, direccion, sintomas_iniciales, prioridad } = req.body;

  try {
    let pacienteRes = await pool.query('SELECT id FROM pacientes WHERE documento_id = $1', [documento_id]);
    let pacienteId;

    if (pacienteRes.rows.length > 0) {
      pacienteId = pacienteRes.rows[0].id;
    } else {
      const nuevoPaciente = await pool.query(
        `INSERT INTO pacientes (nombre, documento_id, telefono, direccion) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [paciente, documento_id, telefono, direccion]
      );
      pacienteId = nuevoPaciente.rows[0].id;
    }

    const nuevaCita = await pool.query(
      `INSERT INTO citas_visitas (paciente_id, sintomas_iniciales, prioridad, estado)
       VALUES ($1, $2, $3, 'Pendiente') RETURNING *`,
      [pacienteId, sintomas_iniciales, prioridad]
    );

    res.status(201).json(nuevaCita.rows[0]);
  } catch (err) {
    console.error('Error en POST /api/citas:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Cambiar estado de cita
app.put('/api/citas/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  try {
    const result = await pool.query(
      `UPDATE citas_visitas SET estado = $1::estado_cita WHERE id = $2 RETURNING *`,
      [estado, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    res.json({ message: 'Estado actualizado correctamente', cita: result.rows[0] });
  } catch (err) {
    console.error('Error en PUT /api/citas/:id/estado:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Eliminar cita
app.delete('/api/citas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM citas_visitas WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    res.json({ message: 'Cita eliminada correctamente' });
  } catch (err) {
    console.error('Error en DELETE /api/citas/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Guardar expediente médico al completar una cita
app.post('/api/expedientes', async (req, res) => {
  const { cita_id, presion_arterial, temperatura_celsius, ritmo_cardiaco_bpm, diagnostico, tratamiento, observaciones } = req.body;

  try {
    const nuevoExpediente = await pool.query(
      `INSERT INTO expedientes_medicos (cita_id, presion_arterial, temperatura_celsius, ritmo_cardiaco_bpm, diagnostico, tratamiento, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [cita_id, presion_arterial, temperatura_celsius, ritmo_cardiaco_bpm, diagnostico, tratamiento, observaciones]
    );

    await pool.query(
      `UPDATE citas_visitas SET estado = 'Completada'::estado_cita WHERE id = $1`,
      [cita_id]
    );

    res.status(201).json({ message: 'Expediente guardado y cita completada', expediente: nuevoExpediente.rows[0] });
  } catch (err) {
    console.error('Error en POST /api/expedientes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Obtener expediente de una cita
app.get('/api/expedientes/:cita_id', async (req, res) => {
  const { cita_id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM expedientes_medicos WHERE cita_id = $1', [cita_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No existe expediente para esta cita' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /api/expedientes:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});