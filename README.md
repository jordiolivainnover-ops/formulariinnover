# Visites d'obra FV

Formulari web per a les visites d'obra. Desa cada visita a monday (amb l'informe en PDF adjunt) i carrega la llista d'obres d'un tauler de monday.

## Estructura

- `server.js`: servidor Node/Express. Parla amb monday i protegeix l'aplicació amb usuari i contrasenya.
- `public/index.html`: el formulari (el mateix del prototip), amb el logo i la generació del PDF.
- `render.yaml`: configuració per desplegar a Render.

## 1. Taulers a monday

Ja estan creats al teu espai de treball de monday:

- **Obres** (ID `5108093888`): afegeix-hi una obra per element.
- **Visites d'obra** (ID `5108093893`): ja té totes les columnes de la taula de sota.

A sota hi ha el detall de les columnes, per si en canvies alguna.

**Tauler d'obres.** Cada element (item) és una obra. Només s'utilitza el nom de l'element.

**Tauler de visites.** Una fila per visita. Les columnes es localitzen pel títol, així que han de dir-se exactament així:

| Títol de la columna | Tipus recomanat |
|---|---|
| Projecte | Text |
| Ubicació | Text (o Ubicació) |
| Data | Data |
| Motiu | Estat |
| Enginyer/a | Text o Estat |
| Cap d'equip | Text o Estat |
| Fase d'obra | Text o Estat |
| Meteorologia | Text o Estat |
| Nº no conformitats | Números |
| No conformitats | Text llarg |
| Observacions | Text llarg |
| Informe PDF | Fitxers |

Les etiquetes que no existeixin a les columnes d'Estat es creen soles. Si falta una columna, el servidor l'ignora i ho deixa al registre.

L'identificador d'un tauler és el número que apareix a l'adreça: `.../boards/5108092710`.

## 2. Token de monday

A monday: avatar > Developers > My access tokens > copia el token personal. Fes servir un usuari que tingui accés als dos taulers. El token no s'ha de posar mai al codi ni a GitHub: només a les variables d'entorn de Render.

## 3. Pujar a GitHub

```bash
cd formulari-obres
git init
git add .
git commit -m "Primera versió"
git branch -M main
git remote add origin https://github.com/EL_TEU_USUARI/visites-obra.git
git push -u origin main
```

Crea abans el repositori buit a github.com (privat, millor).

## 4. Desplegar a Render

1. Render > New > Blueprint (o Web Service) i tria el repositori. Amb `render.yaml` ja ve tot configurat.
2. Omple les variables d'entorn:
   - `MONDAY_API_TOKEN`: el token del pas 2
   - `BOARD_OBRES_ID`: identificador del tauler d'obres
   - `BOARD_VISITES_ID`: identificador del tauler de visites
   - `APP_PASSWORD`: la contrasenya que donaràs a l'equip
   - `APP_USER`: ja ve com a `visites`
3. Quan acabi el desplegament, obre l'adreça `.onrender.com`. El navegador demanarà l'usuari i la contrasenya.

## Notes

- La ubicació del mòbil només funciona amb HTTPS: Render ja el dona.
- El pla gratuït de Render adorm el servei quan no s'utilitza i la primera càrrega pot trigar mig minut. Per a ús a l'obra és millor un pla de pagament.
- Si canvies el nom d'una columna a monday, la nova lectura triga fins a 5 minuts (memòria cau) o fins que reinicies el servei.
- Per provar-ho en local: copia `.env.example` a `.env`, omple'l i executa `npm install` i `node --env-file=.env server.js`.
