import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { AsyncPipe, NgIf } from '@angular/common';

@Component({
  selector: 'app-import',
  imports: [LucideAngularModule, AsyncPipe, NgIf],
  templateUrl: './import.component.html',
  styleUrl: './import.component.scss',
})
export class ImportComponent {
  constructor(public _libraryService: LibraryService) {}

  isGameCd: boolean = false;
  isGameDvd: boolean = true;

  autoDiscoveredId: boolean = false;
  autoDiscoveredName: boolean = false;
  invalidFileDiscovered: boolean = false;
  gamePath: string = '';
  gameName: string = '';
  gameId: string = '';
  downloadArtwork: boolean = true;
  updateConfApps: boolean = true;
  bundledCue2PopsAvailable: boolean | undefined;
  bundledCue2PopsChecked: boolean = false;

  resetImportState() {
    this.autoDiscoveredId = false;
    this.autoDiscoveredName = false;
    this.invalidFileDiscovered = false;
    this.gamePath = '';
    this.gameName = '';
    this.gameId = '';
  }

  ngOnInit() {
    window.libraryAPI
      .isBundledCue2PopsAvailable()
      .then((res) => {
        this.bundledCue2PopsAvailable = !!res?.available;
        this.bundledCue2PopsChecked = true;
      })
      .catch(() => {
        this.bundledCue2PopsAvailable = false;
        this.bundledCue2PopsChecked = true;
      });
  }

  askForGameFile() {
    this._libraryService
      .openAskGameFile(this.isGameCd, this.isGameDvd)
      .then((result) => {
        this.gamePath = result;
        if (result) {
          this._libraryService
            .tryDetermineGameIdFromHex(result)
            .then((lookup) => {
              if (lookup.success) {
                this.autoDiscoveredId = true;
                this.gameId = lookup.gameId;
                if (lookup.gameName) {
                  this.autoDiscoveredName = true;
                  this.gameName = lookup.gameName;
                } else {
                  this.autoDiscoveredName = false;
                  this.gameName = '';
                }
              } else {
                this.autoDiscoveredId = false;
                this.autoDiscoveredName = false;
                this.invalidFileDiscovered = true;
                this.gamePath = '';
                this.gameId = '';
                this.gameName = '';

                setTimeout(() => {
                  this.invalidFileDiscovered = false;
                }, 10000);
              }
            });
        }
      });
  }

  startAutoImportAttempt() {
    console.log(
      'Importing game file:',
      this.gamePath,
      this.gameId,
      this.gameName
    );
    this._libraryService
      .importGameFile(
        this.gamePath,
        this.gameId,
        this.gameName,
        this.downloadArtwork,
        this.isGameCd,
        this.updateConfApps
      )
      .then((result) => {
        console.log(result);
      });
  }
}
