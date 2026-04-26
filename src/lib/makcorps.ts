const MAKCORPS_API_KEY = process.env.MAKCORPS_API_KEY!;
const MAKCORPS_BASE_URL = "https://api.makcorps.com";

export interface MakcorpsHotelResult {
  hotelId: string;
  hotelName: string;
  cityId: string;
  cityName: string;
  checkIn: string;
  checkOut: string;
  price: number;
  currency: string;
  rooms: number;
  adults: number;
  bookingUrl?: string;
}

export interface MakcorpsRawHotel {
  hotel_id?: string;
  id?: string;
  hotel_name?: string;
  name?: string;
  price?: number;
  min_price?: number;
  currency?: string;
  booking_url?: string;
}

// Fetch hotel prices for a given city and date range from Makcorps API
export async function fetchHotelPrices(
  cityId: string,
  checkIn: string, // YYYY-MM-DD
  checkOut: string, // YYYY-MM-DD
  rooms: number = 1,
  adults: number = 2
): Promise<MakcorpsHotelResult[]> {
  const params = new URLSearchParams({
    api_key: MAKCORPS_API_KEY,
    cityid: cityId,
    checkin: checkIn,
    checkout: checkOut,
    rooms: rooms.toString(),
    adults: adults.toString(),
    currency: "USD",
  });

  const url = `${MAKCORPS_BASE_URL}/city?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 0 }, // Never cache — always fresh data
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Makcorps API error: ${response.status} ${response.statusText} — ${errorBody}`
    );
  }

  const data = await response.json();

  // Makcorps returns an array of hotel objects; normalize them
  const hotels: MakcorpsRawHotel[] = Array.isArray(data) ? data : data.hotels ?? data.results ?? [];

  return hotels
    .filter((h: MakcorpsRawHotel) => {
      const price = h.price ?? h.min_price;
      return price !== undefined && price > 0;
    })
    .map((h: MakcorpsRawHotel) => ({
      hotelId: h.hotel_id ?? h.id ?? "",
      hotelName: h.hotel_name ?? h.name ?? "Unknown Hotel",
      cityId,
      cityName: cityId, // Will be resolved by the caller if needed
      checkIn,
      checkOut,
      price: h.price ?? h.min_price ?? 0,
      currency: h.currency ?? "USD",
      rooms,
      adults,
      bookingUrl: h.booking_url,
    }));
}
