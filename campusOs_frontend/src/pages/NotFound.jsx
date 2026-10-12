import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

import { EmptyState } from "../components/ui/States";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That page does not exist, or is not available to your role."
        action={
          <Link
            to="/"
            className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
