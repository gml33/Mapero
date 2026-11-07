# Seguridad

Si encontrás una vulnerabilidad, no abras un issue público con detalles explotables. Contactá al mantenedor mediante un canal privado de GitHub y describí:

- componente y versión afectada;
- pasos mínimos para reproducirla;
- impacto potencial;
- mitigación sugerida, si la conocés.

No envíes credenciales reales ni datos de WiFi/GPS de terceros. Las issues públicas sirven para reportar problemas no sensibles después de coordinar la divulgación.

La configuración de producción debe usar HTTPS, secretos fuera del repositorio y `CORS_ORIGIN` restringido a los dominios necesarios.
