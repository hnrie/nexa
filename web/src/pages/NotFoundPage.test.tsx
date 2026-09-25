// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";

describe("NotFoundPage", () => {
  it("says the address is nothing here and offers a way on", () => {
    render(
      <MemoryRouter initialEntries={["/no/such/page"]}>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page doesn't exist");
    expect(document.title).toBe("This page doesn't exist · Nexa");
    fireEvent.click(screen.getByTestId("not-found-go"));
    expect(screen.getByText("home")).toBeTruthy();
  });
});
