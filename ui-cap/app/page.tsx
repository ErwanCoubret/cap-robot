"use client";

import { useState } from "react";

export default function Home() {
  const [selected, setSelected] = useState<
    undefined | string
  >(undefined);

  return (
    <div className="min-h-screen w-full flex justify-center items-center bg-[#615FFF]">
      <div>
        <div className="text-white text-2xl text-center mb-5">
          Currently selected :{" "}
          <b>{selected !== undefined ? selected : "Undefined"}</b>
        </div>

        <button
            onClick={() => setSelected("plus")}
            className="p-2 w-50 h-50 bg-white rounded cursor-pointer"
          >
            PLUS
          </button>
      </div>
    </div>
  );
}
