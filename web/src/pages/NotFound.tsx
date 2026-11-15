import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";

export function NotFoundPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.pages.notFound.title}</CardTitle>
        <CardDescription>{copy.pages.notFound.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/">{copy.pages.notFound.back}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
