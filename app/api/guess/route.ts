import { reveal } from "@/lib/pool";

export async function POST(request: Request) {
  const { a, b } = await request.json();
  const result = reveal(a, b);
  if (!result) return Response.json({ error: "Unknown video" }, { status: 404 });
  return Response.json(result);
}
