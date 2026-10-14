import { pickPair } from "@/lib/pool";

export async function POST(request: Request) {
  const { seen } = await request.json();
  return Response.json(pickPair(seen));
}
