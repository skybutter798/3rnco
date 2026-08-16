CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL,
    event_key VARCHAR(191) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    recipient VARCHAR(191) NOT NULL,
    reply_to VARCHAR(191) NULL,
    subject VARCHAR(255) NOT NULL,
    body LONGTEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(1000) NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_notification_deliveries_public_id (public_id),
    UNIQUE KEY uq_notification_deliveries_event_key (event_key),
    KEY idx_notification_deliveries_status (status, attempts, created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
