/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Validates URLs to prevent requests to internal/private network addresses.
 * Used by any API route that fetches a user-supplied URL server-side.
 */

/** Check if hostname is in the 172.16.0.0 - 172.31.255.255 private range */
function isPrivate172(hostname: string): boolean {
  if (!hostname.startsWith('172.')) return false;
  const second = parseInt(hostname.split('.')[1], 10);
  return second >= 16 && second <= 31;
}

/**
 * Parse an IP address string and return its numeric components.
 * Supports standard dotted decimal, short form, decimal, octal, and hexadecimal formats.
 */
function parseIpAddress(hostname: string): { type: 'ipv4' | 'ipv6' | 'unknown'; isPrivate: boolean } {
  // IPv6 address
  if (hostname.includes(':')) {
    return checkIpv6Address(hostname);
  }

  // Try to parse as IPv4 in various formats
  const ipv4Result = parseIpv4Address(hostname);
  if (ipv4Result) {
    return { type: 'ipv4', isPrivate: ipv4Result.isPrivate };
  }

  return { type: 'unknown', isPrivate: false };
}

/**
 * Parse IPv4 address in various formats and check if it's private.
 */
function parseIpv4Address(hostname: string): { isPrivate: boolean } | null {
  // Standard dotted decimal format (e.g., 192.168.1.1)
  const standardMatch = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (standardMatch) {
    const octets = [
      parseInt(standardMatch[1], 10),
      parseInt(standardMatch[2], 10),
      parseInt(standardMatch[3], 10),
      parseInt(standardMatch[4], 10),
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Short form IP (e.g., 127.1 = 127.0.0.1, 10.1 = 10.0.0.1)
  const shortFormMatch = /^(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (shortFormMatch) {
    const first = parseInt(shortFormMatch[1], 10);
    const second = parseInt(shortFormMatch[2], 10);
    if (first >= 0 && first <= 255 && second >= 0 && second <= 255) {
      // Short form: 127.1 expands to 127.0.0.1
      const octets = [first, 0, 0, second];
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Decimal IP format (e.g., 2130706433 = 127.0.0.1)
  const decimalMatch = /^(\d{8,})$/.exec(hostname);
  if (decimalMatch) {
    const num = parseInt(decimalMatch[1], 10);
    if (!isNaN(num) && num > 0 && num <= 4294967295) {
      const octets = [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255,
      ];
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Octal IP format (e.g., 0177.0.0.1 or 017700000001)
  const octalMatch = /^0([0-7]+)(?:\.([0-7]+))?(?:\.([0-7]+))?(?:\.([0-7]+))?$/.exec(hostname);
  if (octalMatch) {
    const octets = [
      parseInt(octalMatch[1], 8),
      octalMatch[2] ? parseInt(octalMatch[2], 8) : 0,
      octalMatch[3] ? parseInt(octalMatch[3], 8) : 0,
      octalMatch[4] ? parseInt(octalMatch[4], 8) : 0,
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Hexadecimal IP format (e.g., 0x7f000001 = 127.0.0.1)
  const hexMatch = /^0x([0-9a-f]+)$/i.exec(hostname);
  if (hexMatch) {
    const num = parseInt(hexMatch[1], 16);
    if (!isNaN(num) && num > 0 && num <= 4294967295) {
      const octets = [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255,
      ];
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Mixed notation (e.g., 192.168.257 = 192.168.1.1, where 257 = 1*256 + 1)
  const mixedMatch = /^(\d{1,3})\.(\d{1,3})\.(\d+)$/.exec(hostname);
  if (mixedMatch) {
    const first = parseInt(mixedMatch[1], 10);
    const second = parseInt(mixedMatch[2], 10);
    const third = parseInt(mixedMatch[3], 10);
    if (first >= 0 && first <= 255 && second >= 0 && second <= 255 && third >= 0 && third <= 65535) {
      const octets = [first, second, (third >>> 8) & 255, third & 255];
      return { isPrivate: isPrivateIpv4(octets) };
    }
  }

  return null;
}

/**
 * Check if IPv4 octets represent a private/reserved address.
 */
function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;

  // Loopback: 127.0.0.0/8
  if (a === 127) return true;

  // Private: 10.0.0.0/8
  if (a === 10) return true;

  // Private: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // Private: 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true;

  // Reserved: 0.0.0.0/8
  if (a === 0) return true;

  // Broadcast: 255.255.255.255
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return true;

  // Shared address space: 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;

  // TEST-NET-1: 192.0.2.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true;

  // TEST-NET-2: 198.51.100.0/24
  if (a === 198 && b === 51 && octets[2] === 100) return true;

  // TEST-NET-3: 203.0.113.0/24
  if (a === 203 && b === 0 && octets[2] === 113) return true;

  return false;
}

/**
 * Check IPv6 address for private/reserved ranges.
 */
function checkIpv6Address(hostname: string): { type: 'ipv6'; isPrivate: boolean } {
  const normalized = hostname.toLowerCase();

  // Loopback: ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return { type: 'ipv6', isPrivate: true };
  }

  // Unspecified: ::
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
    return { type: 'ipv6', isPrivate: true };
  }

  // IPv4-mapped IPv6: ::ffff:0:0/96 (e.g., ::ffff:127.0.0.1)
  const ipv4MappedMatch = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(normalized);
  if (ipv4MappedMatch) {
    const octets = [
      parseInt(ipv4MappedMatch[1], 10),
      parseInt(ipv4MappedMatch[2], 10),
      parseInt(ipv4MappedMatch[3], 10),
      parseInt(ipv4MappedMatch[4], 10),
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return { type: 'ipv6', isPrivate: isPrivateIpv4(octets) };
    }
  }

  // IPv4-compatible IPv6: ::/96 (deprecated but still check)
  const ipv4CompatibleMatch = /^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(normalized);
  if (ipv4CompatibleMatch) {
    const octets = [
      parseInt(ipv4CompatibleMatch[1], 10),
      parseInt(ipv4CompatibleMatch[2], 10),
      parseInt(ipv4CompatibleMatch[3], 10),
      parseInt(ipv4CompatibleMatch[4], 10),
    ];
    if (octets.every(o => o >= 0 && o <= 255)) {
      return { type: 'ipv6', isPrivate: isPrivateIpv4(octets) };
    }
  }

  // Unique Local Address (ULA): fc00::/7
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return { type: 'ipv6', isPrivate: true };
  }

  // Link-local: fe80::/10
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || 
      normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return { type: 'ipv6', isPrivate: true };
  }

  // Site-local (deprecated): fec0::/10
  if (normalized.startsWith('fec') || normalized.startsWith('fed') || 
      normalized.startsWith('fee') || normalized.startsWith('fef')) {
    return { type: 'ipv6', isPrivate: true };
  }

  // Documentation addresses: 2001:db8::/32
  if (normalized.startsWith('2001:db8')) {
    return { type: 'ipv6', isPrivate: true };
  }

  return { type: 'ipv6', isPrivate: false };
}

/**
 * List of dangerous hostnames that should be blocked.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'broadcasthost',
]);

/**
 * Validate a URL against SSRF attacks.
 * Returns null if the URL is safe, or an error message string if blocked.
 */
export function validateUrlForSSRF(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Only HTTP(S) URLs are allowed';
  }

  // Self-hosted deployments can set ALLOW_LOCAL_NETWORKS=true to skip private-IP checks
  const allowLocal = process.env.ALLOW_LOCAL_NETWORKS;
  if (allowLocal === 'true' || allowLocal === '1') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return 'Local/private network URLs are not allowed';
  }

  // Check .local, .localhost, .internal TLDs
  if (hostname.endsWith('.local') || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    return 'Local/private network URLs are not allowed';
  }

  // Check for numeric IP addresses in various formats
  const ipResult = parseIpAddress(hostname);
  if (ipResult.isPrivate) {
    return 'Local/private network URLs are not allowed';
  }

  // Check for hostname patterns that indicate local addresses
  if (hostname === '0.0.0.0') {
    return 'Local/private network URLs are not allowed';
  }

  // Legacy checks for backwards compatibility
  if (
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    isPrivate172(hostname) ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80')
  ) {
    return 'Local/private network URLs are not allowed';
  }

  return null;
}

/**
 * Resolve hostname and validate against SSRF.
 * This function should be called after DNS resolution to prevent DNS rebinding attacks.
 * 
 * @param resolvedIp - The resolved IP address
 * @returns null if safe, error message if blocked
 */
export function validateResolvedIpForSSRF(resolvedIp: string): string | null {
  // Self-hosted deployments can skip this check
  const allowLocal = process.env.ALLOW_LOCAL_NETWORKS;
  if (allowLocal === 'true' || allowLocal === '1') {
    return null;
  }

  const ipResult = parseIpAddress(resolvedIp);
  if (ipResult.isPrivate) {
    return 'Resolved IP points to private network';
  }

  return null;
}
