FROM apify/actor-node:20

COPY package*.json ./
# Brez --omit=optional: pdf-parse za branje PDF v Node 20 potrebuje izbirni @napi-rs/canvas
# (sicer pade z »DOMMatrix is not defined«, izmerjeno 14. 10. 2026).
RUN npm install --omit=dev

COPY . ./

CMD npm start --silent
