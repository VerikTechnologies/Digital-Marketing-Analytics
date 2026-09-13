import React from "react";
import { Copy, Download, Power, Pencil, History, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import api from "../api";
import StatusPill from "./StatusPill";

export default function LinkCard({ qr, onUpdate, onEditDest, onHistory }) {
  const downloadImage = (type) => {
    const token = localStorage.getItem("vqr_token");
    window.open(`/api/qrs/${qr.id}/${type}?token=${token}`, "_blank");
  };
  const copyUrl = () => {
    navigator.clipboard.writeText(qr.public_url);
  };
  const toggle = async () => {
    await api.put(`/api/qrs/${qr.id}`, { active: !qr.active });
    onUpdate();
  };

  return (
    <Card className="flex flex-col md:flex-row gap-5 p-5 bg-card hover:bg-muted/50 transition-colors shadow-sm">
      <div className="flex flex-col items-center justify-center bg-white p-2 rounded-lg border w-32 h-32 shrink-0">
        <img
          src={`/api/qrs/${qr.id}/png?token=${localStorage.getItem("vqr_token")}`}
          className="w-full h-full object-contain"
          alt="qr code"
        />
      </div>
      
      <div className="flex flex-col flex-1 gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">{qr.name}</span>
          <StatusPill active={!!qr.active} />
        </div>
        
        <a 
          href={qr.public_url} 
          target="_blank" 
          rel="noreferrer"
          className="text-primary font-medium hover:underline flex items-center gap-2 w-fit"
        >
          {qr.public_url}
          <ExternalLink size={14} />
        </a>
        
        <div className="flex items-center gap-2 text-muted-foreground mt-1 flex-wrap">
          <span className="bg-secondary px-2 py-1 rounded text-xs font-mono">{qr.code}</span>
          {qr.brand_name && <span className="text-sm">• {qr.brand_name}</span>}
          {qr.campaign_name && <span className="text-sm">• {qr.campaign_name}</span>}
        </div>
        
        <div className="flex items-center justify-between mt-auto pt-4">
          <div className="flex gap-6 text-sm">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Total Scans</span>
              <span className="font-semibold text-lg">{qr.scans}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Today</span>
              <span className="font-semibold text-lg">{qr.today}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex md:flex-col gap-2 justify-start items-end md:ml-auto">
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title="Open Link" onClick={() => window.open(qr.public_url, "_blank")}>
            <ExternalLink size={16} />
          </Button>
          <Button variant="outline" size="icon" title="Copy URL" onClick={copyUrl}>
            <Copy size={16} />
          </Button>
          <Button variant="outline" size="icon" title="Download PNG" onClick={() => downloadImage("png")}>
            <Download size={16} />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title="Edit Destination" onClick={() => onEditDest(qr)}>
            <Pencil size={16} />
          </Button>
          <Button variant="outline" size="icon" title="Destination History" onClick={() => onHistory(qr)}>
            <History size={16} />
          </Button>
          <Button 
            variant={qr.active ? "destructive" : "default"} 
            size="icon" 
            title={qr.active ? "Disable QR" : "Enable QR"} 
            onClick={toggle}
          >
            <Power size={16} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

