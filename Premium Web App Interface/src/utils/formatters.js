export function formatMarketCap(value) {
  if (!value || isNaN(value)) return '$0';
  
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export function formatMultiplier(current, target) {
  if (!current || !target || current === 0) return '1x';
  const multiplier = target / current;
  return `${multiplier.toFixed(1)}x`;
}

export function formatPercentage(value) {
  if (!value || isNaN(value)) return '0%';
  return `${parseFloat(value).toFixed(1)}%`;
}

export function truncateAddress(address) {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

