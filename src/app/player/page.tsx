import { redirect } from "next/navigation";

type PlayerPageProps = {
  searchParams: Promise<{
    q?: string | string[];
  }>;
};

export default async function PlayerPage({ searchParams }: PlayerPageProps) {
  const params = await searchParams;
  const query = readFirst(params.q)?.trim() ?? "";
  if (query) {
    redirect(`/player/${encodeURIComponent(query)}`);
  }
  redirect("/");
}

function readFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
