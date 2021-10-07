import { platformNativeScript, runNativeScriptAngularApp } from '@nativescript/angular';
import { enableProdMode } from '@angular/core';
import { environment } from './environments/environment';
import { AppModule } from './app.module';

global.process = {
  nextTick: function (cb) { setTimeout(cb, 0) },
  platform: "Nativescript",
  version: "v0.0.0",
} as any;

if (environment.production) {
  enableProdMode();
}

runNativeScriptAngularApp({
  appModuleBootstrap: () => platformNativeScript().bootstrapModule(AppModule),
});
