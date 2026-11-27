# ---- build the React app (Node 26.13.1) ----
FROM node:26.13.1-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- runtime: Python 3.13, non-root ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/frontend/dist UPLOAD_DIR=/data/uploads
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
RUN useradd --create-home --uid 10001 app && mkdir -p /data/uploads && chown -R app /data
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"
CMD ["sh", "-c", "python -m app.seed --if-empty && exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 2"]
