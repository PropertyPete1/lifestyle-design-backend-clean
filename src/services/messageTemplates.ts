type Listing = {
  address: string;
  type: 'rent' | 'sale';
  ownerName?: string;
};

export function generateMessage(listing: Listing): string {
  const owner = listing.ownerName ? listing.ownerName : 'there';
  if (listing.type === 'rent') {
    return `Hi ${owner}, I’m interested in renting your property at ${listing.address}. Is it still available? I’d love to learn more about the terms and schedule a viewing. Thank you!`;
  }
  return `Hi ${owner}, I saw your FSBO listing at ${listing.address} and had a quick question. Is it still available? I’m a serious buyer and would appreciate more details at your convenience. Thank you!`;
}


