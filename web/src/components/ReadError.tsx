import { AlertTriangle, RotateCw } from "lucide-react";
import { copy } from "@/copy";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

export interface ReadErrorProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/**
 * Inline Alert for read failures (ui-design §4). Keeps the shell and top bar usable.
 */
export function ReadError({ title = copy.error.title, message, onRetry }: ReadErrorProps) {
  return (
    <Alert variant="destructive" data-testid="read-error">
      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </div>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="self-start sm:self-auto">
            <RotateCw aria-hidden="true" />
            {copy.error.retry}
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}
