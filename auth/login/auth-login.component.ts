/*
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 * Copyright 2022 GIP SmartMercial GmbH, Germany
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 */
import { Component, ViewChild } from '@angular/core';

import { environment } from '@environments/environment';

import { EMPTY, Observable } from 'rxjs/';
import { catchError, filter, finalize } from 'rxjs/operators';

import { SelectableLanguage } from '../../api/zeta-environment.interfaces';
import { Comparable } from '../../base/base';
import { I18nParam, I18nService } from '../../i18n/i18n.service';
import { XcAutocompleteDataWrapper, XcDialogService, XcTabBarComponent } from '../../xc';
import { H5FilterError, H5FilterErrorCodes } from '../auth.interfaces';
import { AuthService } from '../auth.service';
import { CredentialsLoginTabComponent } from '../forms/credentials-login-tab.component';
import { SmartCardLoginTabComponent } from '../forms/smart-card-login-tab.component';


export interface LoginComponentData {
    username: string;
    password?: string;
    disabled?: boolean;
    onEnter: () => void;
}


interface LoginTabItem {
    closable: boolean;
    component: any;
    name: string;
    data: LoginComponentData;
}


class ComparableLanguage extends Comparable implements SelectableLanguage {

    label: string;
    baseUrl: string;


    constructor(lang: SelectableLanguage) {
        super();
        this.label = lang.label;
        this.baseUrl = lang.baseUrl;
    }


    equals(other?: this) {
        return this.label === other.label;
    }
}


@Component({
    selector: 'auth-login',
    templateUrl: './auth-login.component.html',
    styleUrls: ['./auth-login.component.scss']
})
export class AuthLoginComponent {

    readonly smartCardTabItem: LoginTabItem = {
        closable: false,
        component: SmartCardLoginTabComponent,
        name: 'SmartCard',
        data: <LoginComponentData>{
            username: '',
            onEnter: this.login.bind(this)
        }
    };

    readonly credentialsTabItem: LoginTabItem = {
        closable: false,
        component: CredentialsLoginTabComponent,
        name: 'Credentials',
        data: <LoginComponentData>{
            username: '',
            password: '',
            onEnter: this.login.bind(this)
        }
    };

    private readonly _selectLanguage: boolean;

    @ViewChild(XcTabBarComponent, { static: false })
    tabBar: XcTabBarComponent;

    tabBarSelection = this.smartCardTabItem;
    smartCardDomain = '';

    selectLanguageDataWrapper: XcAutocompleteDataWrapper;
    selectedLanguage: ComparableLanguage;

    private _pending = false;


    constructor(
        private readonly authService: AuthService,
        private readonly dialogService: XcDialogService,
        private readonly i18n: I18nService
    ) {
        if (this.useSmartCardLogin) {
            this.smartCardInfo();
        }

        const langObj = environment.zeta.auth ? environment.zeta.auth.languages : null;
        const base = document.head.querySelector('base');
        const baseUrl = base ? base.getAttribute('href') : null;

        if ((this._selectLanguage = langObj?.length > 0)) {
            const found = langObj.find(lang => lang.baseUrl === baseUrl) || langObj[0];
            this.selectedLanguage = new ComparableLanguage(found);
            this.selectLanguageDataWrapper = new XcAutocompleteDataWrapper(
                () => this.selectedLanguage,
                (lang: ComparableLanguage) => {
                    const url = window.location.origin + lang.baseUrl + 'Authenticate' + window.location.search;
                    window.location.href = url;
                }
            );
            const mapped = langObj.map(value => {
                value.label = this.i18n.translate(value.label);
                return { name: value.label, value: new ComparableLanguage(value) };
            });
            this.selectLanguageDataWrapper.values = mapped;
        }
    }


    get smartCardMethodUsed(): boolean {
        return this.useSmartCardLogin && (this.tabBarSelection === this.smartCardTabItem || !this.useCredentialsLogin);
    }


    get credentialsMethodUsed(): boolean {
        return this.useCredentialsLogin && (this.tabBarSelection === this.credentialsTabItem || !this.useSmartCardLogin);
    }


    get useSmartCardLogin(): boolean {
        return environment.zeta.auth ? environment.zeta.auth.smartCardLogin : false;
    }


    get useCredentialsLogin(): boolean {
        return environment.zeta.auth ? environment.zeta.auth.credentialsLogin : true;
    }


    get useTabBar(): boolean {
        return this.useCredentialsLogin && this.useSmartCardLogin;
    }


    get selectLanguage(): boolean {
        return this._selectLanguage;
    }


    login() {
        if (this.smartCardMethodUsed) {
            this.smartCardLogin();
        } else if (this.credentialsMethodUsed) {
            this.credentialsLogin();
        }
    }


    smartCardInfo() {
        this.authService.fetchSmartCardInfo().pipe(
            filter(info => !!info)
        ).subscribe(info => {
            this.smartCardTabItem.data.username = info.username || '';
            this.smartCardDomain = (info.externaldomains || [])[0] || '';
        });
    }


    defaultErrorHandler(): Observable<void> {
        return this.dialogService.info(this.i18n.translate('zeta.auth-login.error'), this.i18n.translate('zeta.auth-login.authentication-failed')).afterDismiss();
    }


    smartCardLogin(force = false) {
        this.pending = true;
        const forcedLogin = force || !!(environment.zeta.auth && environment.zeta.auth.useTheForcedLogin);
        this.authService.smartCardLogin(this.smartCardDomain, forcedLogin).pipe(
            catchError(error => {
                /**
                 * TODO
                 * Check with H5Filter if this error object structure will be used in all projects.
                 * This structure is only an assumption.
                 */
                const filterError = error as H5FilterError;
                if (filterError && filterError.error) {
                    const errorCode = filterError.error.error ? filterError.error.error.errorCode : (filterError.error as any).errorCode;
                    if (errorCode === H5FilterErrorCodes.SESSION_EXISTS) {
                        this.dialogService.confirm(
                            this.i18n.translate('zeta.auth-login.error-header'),
                            this.i18n.translate('zeta.auth-login.error-message', <I18nParam>{ key: '$0', value: this.smartCardTabItem.data.username })
                        ).afterDismissResult(true).subscribe(() =>
                            this.smartCardLogin(true)
                        );
                        return EMPTY;
                    }
                }
                return this.defaultErrorHandler();
            }),
            finalize(() => this.pending = false)
        ).subscribe();
    }


    credentialsLogin(force = false) {
        this.pending = true;
        const forcedLogin = force || !!(environment.zeta.auth && environment.zeta.auth.useTheForcedLogin);
        this.authService.login(this.credentialsTabItem.data.username, this.credentialsTabItem.data.password, forcedLogin).pipe(
            catchError(loginError => {
                // FIXME: Use Error-Datatype (ZETA-6)
                const filterError = loginError as H5FilterError;
                if (filterError && filterError.error) {
                    const errorCode = filterError.error.error ? filterError.error.error.errorCode : (filterError.error as any).errorCode;
                    if (errorCode === H5FilterErrorCodes.SESSION_EXISTS) {
                        this.dialogService.confirm(
                            this.i18n.translate('zeta.auth-login.duplicate-session-header'),
                            this.i18n.translate('zeta.auth-login.duplicate-session-message', <I18nParam>{ key: '$username', value: this.credentialsTabItem.data.username })
                        ).afterDismissResult(true).subscribe(() =>
                            // login again with force
                            this.credentialsLogin(true)
                        );
                        return EMPTY;
                    }
                }
                return this.defaultErrorHandler();
            }),
            finalize(() => this.pending = false)
        ).subscribe();
    }


    get pending(): boolean {
        return this._pending;
    }


    set pending(value: boolean) {
        this._pending = value;

        this.smartCardTabItem.data.disabled = this.pending;
        this.credentialsTabItem.data.disabled = this.pending;
    }
}
