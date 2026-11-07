# Contribuir a Mapero

Gracias por tu interés en mejorar Mapero.

## Antes de abrir un cambio

- Buscá issues existentes y describí el problema o la propuesta.
- No incluy credenciales, datos personales, SSID/BSSID reales ni coordenadas GPS reales en commits, tests o capturas.
- Mantené los cambios acotados y actualizá la documentación cuando corresponda.

## Validación local

```bash
cd server
npm ci
npm test
npm run check

cd ../android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

Los cambios de comportamiento deben incluir tests cuando exista un lugar razonable para agregarlos. Los pull requests pasan por CI antes de incorporarse.
