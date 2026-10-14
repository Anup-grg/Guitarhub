export type Ad = {
  id: string;
  imageUrl: string;
  linkUrl: string;
  alt?: string;
};

export const defaultAds: Ad[] = [
  {
    id: "ad-1",
    imageUrl: "https://placehold.co/1976x688.png?text=Ad+1",
    linkUrl: "https://example.com",
    alt: "Ad 1",
  },
  {
    id: "ad-2",
    imageUrl: "https://placehold.co/1976x688.png?text=Ad+2",
    linkUrl: "https://example.com/2",
    alt: "Ad 2",
  },
  {
    id: "ad-3",
    imageUrl: "https://placehold.co/1976x688.png?text=Ad+3",
    linkUrl: "https://example.com/3",
    alt: "Ad 3",
  },
];
