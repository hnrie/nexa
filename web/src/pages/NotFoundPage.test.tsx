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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This Page Doesn't Exist");
    expect(document.title).toBe("This Page Doesn't Exist · Nexa");
    fireEvent.click(screen.getByTestId("not-found-go"));
    expect(screen.getByText("home")).toBeTruthy();
  });
});
