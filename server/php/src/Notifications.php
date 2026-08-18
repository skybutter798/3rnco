<?php

declare(strict_types=1);

namespace Rnco;

use Closure;
use PDOException;
use Throwable;

final class NotificationService
{
    /** @var null|Closure(string,string,string,string,string):bool */
    private readonly ?Closure $transport;

    /** @param null|Closure(string,string,string,string,string):bool $transport */
    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
        ?Closure $transport = null,
    ) {
        $this->transport = $transport;
    }

    /** @param array<string, mixed> $order */
    public function notifyNewOrder(array $order): void
    {
        $items = [];
        foreach ((array) ($order['lines'] ?? []) as $line) {
            if (!is_array($line)) {
                continue;
            }
            $items[] = sprintf(
                '- %s x%d @ RM%s',
                $this->clean((string) ($line['name'] ?? 'Item')),
                (int) ($line['quantity'] ?? 0),
                number_format((float) ($line['unitPrice'] ?? 0), 2),
            );
        }
        if ($items === []) {
            $items[] = '- Order line details are available in the admin portal.';
        }

        $address = is_array($order['shippingAddress'] ?? null) ? $order['shippingAddress'] : [];
        $addressText = implode(', ', array_values(array_filter(array_map(
            fn (mixed $value): string => $this->clean((string) $value),
            [
                $address['address1'] ?? $address['address'] ?? '',
                $address['address2'] ?? '',
                $address['postcode'] ?? '',
                $address['city'] ?? '',
                $address['state'] ?? '',
                $address['country'] ?? 'Malaysia',
            ],
        ))));
        $orderNumber = $this->clean((string) ($order['orderNumber'] ?? 'Unknown'));
        $customerEmail = $this->validEmail($order['customerEmail'] ?? null);

        $this->queue(
            'order.created:' . (string) ($order['id'] ?? $orderNumber),
            'order.created',
            '[3R&Co] New order ' . $orderNumber . ' - RM' . number_format((float) ($order['total'] ?? 0), 2),
            implode("\n", [
                'A new order has been placed.',
                '',
                'Order: ' . $orderNumber,
                'Placed: ' . $this->clean((string) ($order['createdAt'] ?? Security::now())),
                'Customer: ' . $this->clean((string) ($order['customerName'] ?? '')),
                'Email: ' . ($customerEmail ?? ''),
                'Phone: ' . $this->clean((string) ($address['phone'] ?? '')),
                'Delivery: ' . $addressText,
                '',
                'Items:',
                ...$items,
                '',
                'Subtotal: RM' . number_format((float) ($order['subtotal'] ?? 0), 2),
                'Discount: RM' . number_format((float) ($order['discount'] ?? 0), 2),
                'Shipping: RM' . number_format((float) ($order['shipping'] ?? 0), 2),
                'Total: RM' . number_format((float) ($order['total'] ?? 0), 2),
                'Payment status: ' . $this->clean((string) ($order['paymentStatus'] ?? 'pending')),
                'Promo code: ' . $this->clean((string) ($order['promoCode'] ?? '-')),
                'Referral code: ' . $this->clean((string) ($order['referralCode'] ?? '-')),
                '',
                'Open admin: ' . $this->config->string('mail.admin_url'),
            ]),
            $customerEmail,
        );
    }

    /** @param array<string, mixed> $order @param array<string, mixed> $receipt */
    public function notifyPaymentReceiptSubmitted(array $order, array $receipt): void
    {
        $orderNumber = $this->clean((string) ($order['orderNumber'] ?? 'Unknown'));
        $customerEmail = $this->validEmail($order['customerEmail'] ?? null);
        $this->queue(
            'payment.receipt.submitted:' . (string) ($receipt['id'] ?? ''),
            'payment.receipt.submitted',
            '[3R&Co] Payment proof received for ' . $orderNumber,
            implode("\n", [
                'A customer submitted payment proof.',
                '',
                'Order: ' . $orderNumber,
                'Customer: ' . $this->clean((string) ($order['customerName'] ?? '')),
                'Email: ' . ($customerEmail ?? ''),
                'Order total: RM' . number_format((float) ($order['total'] ?? 0), 2),
                'Payment method: ' . $this->clean((string) ($receipt['paymentMethodId'] ?? '')),
                'Customer reference: ' . $this->clean((string) ($receipt['customerReference'] ?? '-')),
                'Customer note: ' . $this->clean((string) ($receipt['customerNote'] ?? '-')),
                'Receipt file: ' . $this->clean((string) ($receipt['originalName'] ?? '')),
                'Submitted: ' . $this->clean((string) ($receipt['createdAt'] ?? Security::now())),
                '',
                'The private receipt is not attached. Review it securely in admin:',
                $this->config->string('mail.admin_url'),
            ]),
            $customerEmail,
        );
    }

    /** @param array<string, mixed> $before @param array<string, mixed> $after */
    public function notifyOrderStatusChanged(array $before, array $after): void
    {
        $previous = (string) ($before['status'] ?? '');
        $status = (string) ($after['status'] ?? '');
        if ($status === '' || $status === $previous) return;

        $orderId = (string) ($after['id'] ?? 'unknown');
        $orderNumber = $this->clean((string) ($after['orderNumber'] ?? $orderId));
        $customerEmail = $this->validEmail($after['customerEmail'] ?? null);
        $customerName = $this->clean((string) ($after['customerName'] ?? 'Customer'));
        $label = ucwords(str_replace('_', ' ', $status));
        $previousLabel = ucwords(str_replace('_', ' ', $previous));
        $eventId = Security::uuid();

        if ($customerEmail !== null) {
            $this->queue(
                'order.status.updated:' . $orderId . ':' . $eventId . ':customer',
                'order.status.updated.customer',
                '[3R&Co] Order ' . $orderNumber . ' is now ' . $label,
                implode("\n", [
                    'Hello ' . $customerName . ',',
                    '',
                    'Your order status has been updated.',
                    '',
                    'Order: ' . $orderNumber,
                    'Previous status: ' . $previousLabel,
                    'New status: ' . $label,
                    'Updated: ' . $this->clean((string) ($after['updatedAt'] ?? Security::now())),
                    '',
                    'You can review the order in My Account:',
                    rtrim($this->config->string('app.origin'), '/') . '/?account=orders',
                    '',
                    'If you need help, reply to this email and our care team will assist you.',
                ]),
                $this->validEmail($this->config->string('mail.recipient')),
                $customerEmail,
            );
        }

        $this->queue(
            'order.status.updated:' . $orderId . ':' . $eventId . ':admin',
            'order.status.updated.admin',
            '[3R&Co] Order ' . $orderNumber . ' changed to ' . $label,
            implode("\n", [
                'An administrator changed an order status.',
                '',
                'Order: ' . $orderNumber,
                'Customer: ' . $customerName,
                'Email: ' . ($customerEmail ?? ''),
                'Previous status: ' . $previousLabel,
                'New status: ' . $label,
                'Payment status: ' . $this->clean((string) ($after['paymentStatus'] ?? '')),
                'Updated: ' . $this->clean((string) ($after['updatedAt'] ?? Security::now())),
                '',
                'Open admin: ' . $this->config->string('mail.admin_url'),
            ]),
            $customerEmail,
        );
    }

    /** @param array<string, mixed> $enquiry */
    public function notifyNewEnquiry(array $enquiry): void
    {
        $replyTo = $this->validEmail($enquiry['email'] ?? null);
        $subject = $this->clean((string) ($enquiry['subject'] ?? 'Website enquiry'));
        $this->queue(
            'enquiry.created:' . (string) ($enquiry['id'] ?? ''),
            'enquiry.created',
            '[3R&Co] New enquiry - ' . mb_substr($subject, 0, 180),
            implode("\n", [
                'A new customer enquiry was received.',
                '',
                'Name: ' . $this->clean((string) ($enquiry['name'] ?? '')),
                'Email: ' . ($replyTo ?? ''),
                'Phone: ' . $this->clean((string) ($enquiry['phone'] ?? '-')),
                'Channel: ' . $this->clean((string) ($enquiry['channel'] ?? 'website')),
                'Subject: ' . $subject,
                'Received: ' . $this->clean((string) ($enquiry['createdAt'] ?? Security::now())),
                '',
                'Message:',
                $this->clean((string) ($enquiry['message'] ?? '')),
                '',
                'Open admin: ' . $this->config->string('mail.admin_url'),
            ]),
            $replyTo,
        );
    }

    public function sendSystemTest(): string
    {
        $eventKey = 'system.test:' . gmdate('YmdHis') . ':' . bin2hex(random_bytes(4));
        $this->queue(
            $eventKey,
            'system.test',
            '[3R&Co] Notification system test',
            implode("\n", [
                'The 3R&Co platform notification system is active.',
                '',
                'Environment: ' . $this->config->string('app.env'),
                'Generated: ' . Security::now(),
                'Admin: ' . $this->config->string('mail.admin_url'),
            ]),
            null,
        );

        return $eventKey;
    }

    public function flushPending(int $limit = 25): int
    {
        if (!$this->config->bool('mail.enabled')) {
            return 0;
        }
        $limit = max(1, min(100, $limit));
        $maxAttempts = max(1, $this->config->int('mail.max_attempts'));
        $rows = $this->database->fetchAll(
            "SELECT id FROM notification_deliveries WHERE status IN ('pending','failed') AND attempts < ? ORDER BY created_at, id LIMIT {$limit}",
            [$maxAttempts],
        );
        foreach ($rows as $row) {
            $this->deliver((int) $row['id']);
        }

        return count($rows);
    }

    private function queue(string $eventKey, string $eventType, string $subject, string $body, ?string $replyTo, ?string $recipientOverride = null): void
    {
        $recipient = $this->validEmail($recipientOverride ?? $this->config->string('mail.recipient'));
        if ($recipient === null) {
            error_log('[3rnco-mail] Notification recipient is not configured.');
            return;
        }
        $now = Security::now();
        try {
            $this->database->execute(
                'INSERT INTO notification_deliveries (public_id, event_key, event_type, recipient, reply_to, subject, body, status, attempts, last_error, sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Security::uuid(), mb_substr($eventKey, 0, 191), mb_substr($eventType, 0, 80), $recipient, $replyTo, mb_substr($this->clean($subject), 0, 255), $this->clean($body), 'pending', 0, null, null, $now, $now],
            );
        } catch (PDOException $exception) {
            if ((string) $exception->getCode() === '23000' || str_contains(strtolower($exception->getMessage()), 'unique')) {
                return;
            }
            error_log('[3rnco-mail] Unable to queue ' . $eventType . ': ' . $exception->getMessage());
            return;
        } catch (Throwable $exception) {
            error_log('[3rnco-mail] Unable to queue ' . $eventType . ': ' . $exception->getMessage());
            return;
        }

        $id = $this->database->lastInsertId();
        if (!$this->config->bool('mail.enabled')) {
            $this->database->execute("UPDATE notification_deliveries SET status = 'disabled', updated_at = ? WHERE id = ?", [$now, $id]);
            return;
        }
        $this->deliver($id);
    }

    private function deliver(int $id): bool
    {
        $row = $this->database->fetchOne('SELECT * FROM notification_deliveries WHERE id = ?', [$id]);
        if ($row === null || in_array((string) $row['status'], ['sent', 'disabled'], true)) {
            return false;
        }
        $fromAddress = $this->validEmail($this->config->string('mail.from_address'));
        if ($fromAddress === null) {
            $this->markFailed($id, 'The configured From address is invalid.');
            return false;
        }

        $fromName = $this->clean($this->config->string('mail.from_name'));
        $encodedName = mb_encode_mimeheader($fromName, 'UTF-8');
        $headers = implode("\r\n", array_filter([
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            'From: ' . $encodedName . ' <' . $fromAddress . '>',
            $row['reply_to'] !== null ? 'Reply-To: ' . $row['reply_to'] : null,
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
            'X-3RNCO-Event: ' . preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $row['event_type']),
        ]));
        $subject = mb_encode_mimeheader((string) $row['subject'], 'UTF-8');
        $body = str_replace(["\r\n", "\r"], "\n", (string) $row['body']);
        $body = str_replace("\n", "\r\n", $body);

        try {
            $this->database->execute('UPDATE notification_deliveries SET attempts = attempts + 1, updated_at = ? WHERE id = ?', [Security::now(), $id]);
            $transport = $this->transport;
            $sent = $transport !== null
                ? $transport((string) $row['recipient'], $subject, $body, $headers, $fromAddress)
                : @mail((string) $row['recipient'], $subject, $body, $headers, '-f' . $fromAddress);
            if (!$sent) {
                $this->markFailed($id, 'The local mail transport returned false.');
                return false;
            }
            $now = Security::now();
            $this->database->execute("UPDATE notification_deliveries SET status = 'sent', last_error = NULL, sent_at = ?, updated_at = ? WHERE id = ?", [$now, $now, $id]);
            return true;
        } catch (Throwable $exception) {
            $this->markFailed($id, $exception->getMessage());
            return false;
        }
    }

    private function markFailed(int $id, string $error): void
    {
        $message = mb_substr($this->clean($error), 0, 1000);
        try {
            $this->database->execute("UPDATE notification_deliveries SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", [$message, Security::now(), $id]);
        } catch (Throwable) {
            // The business event has already committed; never turn a mail failure into an API failure.
        }
        error_log('[3rnco-mail] Delivery failed for notification ' . $id . ': ' . $message);
    }

    private function validEmail(mixed $value): ?string
    {
        $email = strtolower(trim((string) $value));
        if ($email === '' || str_contains($email, "\r") || str_contains($email, "\n") || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return null;
        }

        return $email;
    }

    private function clean(string $value): string
    {
        return trim(str_replace("\0", '', $value));
    }
}
