# ---- Build the web UI ----
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY webpack.config.js .babelrc* ./
COPY js ./js
COPY css ./css
COPY static ./static
RUN npm run build

# ---- Runtime ----
FROM python:3.12-slim
LABEL org.opencontainers.image.description="Micboard - visual monitoring for Shure network wireless systems"

WORKDIR /usr/src/app
ENV PYTHONUNBUFFERED=1

COPY py/requirements.txt py/requirements.txt
RUN pip install --no-cache-dir -r py/requirements.txt

COPY py ./py
COPY demo.html index.html democonfig.json dcid.json package.json ./
COPY --from=web /app/static ./static

EXPOSE 8058
CMD ["python3", "py/micboard.py"]
