import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/.well-known/microsoft-identity-association.json"
)({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          associatedApplications: [
            {
              applicationId: "8a2e7295-787c-4728-b3f3-b3a9dd829e1f",
            },
          ],
        });
      },
    },
  },
});
