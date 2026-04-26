/**
 * POST /api/hotels/scan
 *
 * Fetches hotel prices from Makcorps for a given city and date,
 * persists them to Supabase (upsert), computes 30-day average,
 * and returns enriched JSON with deal analysis.
 *
 * Body:
 *   {
 *     cityId: string,      // Makcorps city ID
 *     cityName: string,    // Human-readable name for display
 *     checkIn: string,     // YYYY-MM-DD
 *     checkOut: string,    // YYYY-MM-DD
 *     rooms?: number,      // default 1
 *     adults?: number      // default 2
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchHotelPrices, MakcorpsHotelResult } from "@/lib/makcorps";
import { analyzeDeal, DealAnalysis } from "@/lib/dealDetection";

// --- Types ------------------------------------------------------------------

interface ScanRequestBody {
  cityId: string;
  cityName: string;
  checkIn: string;
  checkOut: string;
  rooms?: number;
  adults?: number;
}

interface HotelPriceRecord {
  hotel_id: string;
  hotel_name: string;
  city_id: string;
  city_name: string;
  check_in: string;
  check_out: string;
  price: number;
  currency: string;
  scanned_at: string;
  booking_url: string | null;
}

interface EnrichedHotel extends MakcorpsHotelResult {
  deal: DealAnalysis;
  savedAt: string;
}

// --- Helpers ----------------------------------------------------------------

function validateDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

async function getPrice30DayHistory(
  hotelId: string,
  checkIn: string
): Promise<number[]> {
  const thirtyDaysAgo = new Date(checkIn);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from("hotel_prices")
    .select("price")
    .eq("hotel_id", hotelId)
    .gte("scanned_at", thirtyDaysAgo.toISOString())
    .lt("scanned_at", new Date(checkIn).toISOString())
    .order("scanned_at", { ascending: false });

  if (error) {
    console.error("Error fetching price history:", error);
    return [];
  }

  return (data ?? []).map((row: { price: number }) => row.price);
}

// --- Handler ----------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Parse and validate body
  let body: ScanRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cityId, cityName, checkIn, checkOut, rooms = 1, adults = 2 } = body;

  if (!cityId || !cityName || !checkIn || !checkOut) {
    return NextResponse.json(
      { error: "Missing required fields: cityId, cityName, checkIn, checkOut" },
      { status: 400 }
    );
  }

  if (!validateDate(checkIn) || !validateDate(checkOut)) {
    return NextResponse.json(
      { error: "Dates must be in YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  if (new Date(checkIn) >= new Date(checkOut)) {
    return NextResponse.json(
      { error: "checkIn must be before checkOut" },
      { status: 400 }
    );
  }

  const scannedAt = new Date().toISOString();

  // 2. Fetch prices from Makcorps
  let hotels: MakcorpsHotelResult[];
  try {
    hotels = await fetchHotelPrices(cityId, checkIn, checkOut, rooms, adults);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from Makcorps: ${message}` },
      { status: 502 }
    );
  }

  if (hotels.length === 0) {
    return NextResponse.json(
      { message: "No hotels returned from Makcorps for these parameters", results: [] },
      { status: 200 }
    );
  }

  // 3. Persist to Supabase (upsert by hotel_id + check_in + scanned_at date)
  const records: HotelPriceRecord[] = hotels.map((h) => ({
    hotel_id: h.hotelId,
    hotel_name: h.hotelName,
    city_id: h.cityId,
    city_name: cityName,
    check_in: checkIn,
    check_out: checkOut,
    price: h.price,
    currency: h.currency,
    scanned_at: scannedAt,
    booking_url: h.bookingUrl ?? null,
  }));

  const { error: upsertError } = await supabase
    .from("hotel_prices")
    .upsert(records, {
      onConflict: "hotel_id,check_in,scanned_at",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error("Supabase upsert error:", upsertError);
    return NextResponse.json(
      { error: `Database write failed: ${upsertError.message}` },
      { status: 500 }
    );
  }

  // 4. Enrich each hotel with 30-day deal analysis
  const enriched: EnrichedHotel[] = await Promise.all(
    hotels.map(async (hotel) => {
      const history = await getPrice30DayHistory(hotel.hotelId, checkIn);
      const deal = analyzeDeal(hotel.price, history);
      return { ...hotel, deal, savedAt: scannedAt };
    })
  );

  // 5. Sort: best deals first
  enriched.sort((a, b) => b.deal.savingsPercent - a.deal.savingsPercent);

  // 6. Return structured response
  return NextResponse.json(
    {
      scannedAt,
      cityId,
      cityName,
      checkIn,
      checkOut,
      rooms,
      adults,
      totalHotels: enriched.length,
      deals: enriched.filter((h) => h.deal.tier === "DEAL").length,
      greatDeals: enriched.filter((h) => h.deal.tier === "GREAT_DEAL").length,
      results: enriched,
    },
    { status: 200 }
  );
}

// GET is not supported — scanning is always a write operation
export async function GET() {
  return NextResponse.json(
    { error: "Use POST with { cityId, cityName, checkIn, checkOut }" },
    { status: 405 }
  );
}
