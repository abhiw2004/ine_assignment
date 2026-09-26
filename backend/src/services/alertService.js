import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { insertAlert } from '../db/trackedRepo.js';

/**
 * Compare the freshly scraped quote against the previous snapshot stored on the
 * tracked row and raise honest alerts (bonus feature). Also used for
 * structure-change detection.
 *
 * @param {object} tracked  the tracked_products row BEFORE this scrape
 * @param {object} data     the successful scrape data
 * @returns {Promise<object[]>} alerts that were recorded
 */
export async function detectAndRecordAlerts(tracked, data) {
  if (!config.alertsEnabled) return [];
  const raised = [];

  const prevPrice = tracked.last_price != null ? Number(tracked.last_price) : null;
  const prevStock = tracked.last_stock != null ? Number(tracked.last_stock) : null;
  const prevInStock = tracked.last_in_stock;

  // price drop / rise
  if (prevPrice != null && Number.isFinite(prevPrice) && prevPrice > 0) {
    const pct = ((data.price - prevPrice) / prevPrice) * 100;
    const dropThreshold = config.priceDropPct; // 0 => alert on any drop
    if (pct < 0 && (dropThreshold === 0 || pct <= -dropThreshold)) {
      raised.push({
        kind: 'price_drop',
        message: `${tracked.name} (${tracked.option_label}) dropped ${Math.abs(pct).toFixed(1)}% — ₹${prevPrice} → ₹${data.price}`,
        oldValue: prevPrice,
        newValue: data.price,
      });
    } else if (pct > 0) {
      raised.push({
        kind: 'price_rise',
        message: `${tracked.name} (${tracked.option_label}) rose ${pct.toFixed(1)}% — ₹${prevPrice} → ₹${data.price}`,
        oldValue: prevPrice,
        newValue: data.price,
      });
    }
  }

  // back in stock / out of stock
  if (prevInStock === false && data.inStock === true) {
    raised.push({
      kind: 'back_in_stock',
      message: `${tracked.name} (${tracked.option_label}) is back in stock (${data.stock} available)`,
      oldValue: prevStock ?? 0,
      newValue: data.stock,
    });
  } else if (prevInStock === true && data.inStock === false) {
    raised.push({
      kind: 'out_of_stock',
      message: `${tracked.name} (${tracked.option_label}) went out of stock`,
      oldValue: prevStock ?? 0,
      newValue: 0,
    });
  }

  for (const a of raised) {
    try {
      await insertAlert(tracked.id, a);
    } catch (err) {
      logger.warn(`alert persist failed: ${err.message}`);
    }
  }

  if (raised.length) {
    logger.info(`alerts: ${raised.length} raised for ${tracked.name} (${tracked.option_label})`);
    // fire-and-forget email (only if SendGrid configured)
    maybeEmail(tracked, raised).catch((e) => logger.warn(`alert email failed: ${e.message}`));
  }
  return raised;
}

/** Optional SendGrid email. No-op unless SENDGRID_API_KEY + ALERT_EMAIL_TO set. */
async function maybeEmail(tracked, alerts) {
  if (!config.sendgridKey || !config.alertEmailTo) return;
  const subject = `[Price Tracker] ${alerts.length} update(s) for ${tracked.name}`;
  const text = alerts.map((a) => `• ${a.message}`).join('\n');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.sendgridKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: config.alertEmailTo }] }],
      from: { email: config.alertEmailFrom },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`SendGrid ${res.status}`);
  }
  logger.info(`alert email sent to ${config.alertEmailTo}`);
}
