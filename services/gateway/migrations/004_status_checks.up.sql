-- Status page: health check history
CREATE TABLE IF NOT EXISTS status_checks (
    id BIGSERIAL PRIMARY KEY,
    service VARCHAR(30) NOT NULL,
    status VARCHAR(10) NOT NULL, -- 'up', 'down', 'degraded'
    latency_ms INT NOT NULL DEFAULT 0,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_checks_service_time ON status_checks (service, checked_at DESC);

-- Incidents log
CREATE TABLE IF NOT EXISTS status_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'investigating', -- investigating, identified, monitoring, resolved
    severity VARCHAR(20) NOT NULL DEFAULT 'minor', -- minor, major, critical
    affected_services TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-cleanup: keep 91 days of checks (UI shows 90-day grid)
CREATE OR REPLACE FUNCTION cleanup_old_status_checks() RETURNS void AS $$
BEGIN
    DELETE FROM status_checks WHERE checked_at < NOW() - INTERVAL '91 days';
END;
$$ LANGUAGE plpgsql;
