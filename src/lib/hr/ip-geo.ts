/**
 * IP geolocation / anti-VPN assessment for attendance check-in (§F, P2.1c).
 *
 * `assessIp` makes ONE best-effort outbound call to a third-party IP-geo service,
 * sending only the caller's IP. It is provider-swappable via `IP_GEO_URL` (a URL
 * template containing `{ip}`) and can be disabled entirely with `IP_GEO_ENABLED=false`
 * (CI/offline). It NEVER throws and NEVER blocks: any provider outage, timeout, or
 * unassessable IP resolves to a neutral, non-suspect default. We FLAG, we never BLOCK.
 *
 * This lib only knows the IP — geo-vs-GPS mismatch is decided by the caller.
 */

export interface IpAssessment {
  country: string | null;
  lat: number | null;
  lng: number | null;
  isProxy: boolean;
  isHosting: boolean;
  isMobile: boolean;
  is_vpn_suspect: boolean;
  reason: string | null;
}

const NEUTRAL: IpAssessment = {
  country: null,
  lat: null,
  lng: null,
  isProxy: false,
  isHosting: false,
  isMobile: false,
  is_vpn_suspect: false,
  reason: null,
};

const FETCH_TIMEOUT_MS = 2500;
const DEFAULT_URL =
  'http://ip-api.com/json/{ip}?fields=status,message,countryCode,lat,lon,proxy,hosting,mobile,query';

/**
 * True for IPs we must never flag: loopback, private (RFC1918), link-local, CGNAT,
 * and IPv6 unique-local / link-local. Unassessable IPs (incl. localhost `::1`) must
 * resolve to the neutral default so dev/CI never marks anyone suspect.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (addr === '::1') return true;

  // IPv4 (also handles IPv4-mapped IPv6 like ::ffff:10.0.0.1 via suffix parse).
  const v4 = addr.includes('.') ? addr.slice(addr.lastIndexOf(':') + 1) : addr;
  const octets = v4.split('.');
  if (octets.length === 4) {
    const [a, b] = octets.map((o) => Number(o));
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }

  // IPv6 prefix checks.
  if (addr.startsWith('fe80')) return true; // link-local
  const first = addr.slice(0, 2);
  if (first === 'fc' || first === 'fd') return true; // fc00::/7 unique-local
  return false;
}

interface IpApiResponse {
  status?: unknown;
  countryCode?: unknown;
  lat?: unknown;
  lon?: unknown;
  proxy?: unknown;
  hosting?: unknown;
  mobile?: unknown;
}

function buildReason(isProxy: boolean, isHosting: boolean): string | null {
  if (isProxy && isHosting) return 'proxy+datacenter';
  if (isProxy) return 'proxy/vpn';
  if (isHosting) return 'datacenter';
  return null;
}

export async function assessIp(ip: string | null | undefined): Promise<IpAssessment> {
  if (!ip || ip.trim().length === 0) return NEUTRAL;
  if (isPrivateOrReservedIp(ip)) return NEUTRAL;
  if (process.env.IP_GEO_ENABLED === 'false') return NEUTRAL;

  const template = process.env.IP_GEO_URL || DEFAULT_URL;
  const url = template.replace('{ip}', encodeURIComponent(ip.trim()));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return NEUTRAL;
    const json = (await res.json()) as IpApiResponse;
    if (json.status !== 'success') return NEUTRAL;

    const country = typeof json.countryCode === 'string' ? json.countryCode : null;
    const lat = typeof json.lat === 'number' ? json.lat : null;
    const lng = typeof json.lon === 'number' ? json.lon : null;
    const isProxy = json.proxy === true;
    const isHosting = json.hosting === true;
    const isMobile = json.mobile === true;
    const is_vpn_suspect = isProxy || isHosting;

    return {
      country,
      lat,
      lng,
      isProxy,
      isHosting,
      isMobile,
      is_vpn_suspect,
      reason: is_vpn_suspect ? buildReason(isProxy, isHosting) : null,
    };
  } catch {
    return NEUTRAL;
  } finally {
    clearTimeout(timer);
  }
}
