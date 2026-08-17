FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PRICE_WORKER_STATE_DIR=/data

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 10001 worker \
    && mkdir -p /data \
    && chown -R worker:worker /data

USER worker
VOLUME ["/data"]

ENTRYPOINT ["enlaze-price-worker"]
CMD ["roca"]
