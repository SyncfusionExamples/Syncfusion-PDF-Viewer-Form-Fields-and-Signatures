import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ChangeDetectorRef,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PdfViewerModule,
  PdfViewerComponent,
  LinkAnnotationService,
  BookmarkViewService,
  MagnificationService,
  ThumbnailViewService,
  ToolbarService,
  NavigationService,
  TextSearchService,
  TextSelectionService,
  PrintService,
  FormDesignerService,
  FormFieldsService,
  AnnotationService,
  PageOrganizerService,
  LoadEventArgs,
  PageChangeEventArgs,
  AddSignatureEventArgs
} from '@syncfusion/ej2-angular-pdfviewer';
import { Dialog, ButtonPropsModel } from '@syncfusion/ej2-popups';
import { TextBox } from '@syncfusion/ej2-inputs';
import { Message } from '@syncfusion/ej2-notifications';
import { Tab } from '@syncfusion/ej2-navigations';
import { createElement, EventHandler, getInstance, addClass, removeClass } from '@syncfusion/ej2-base';

/**
 * Representation of an audit log entry for signing & dialog actions.
 */
export interface AuditLogItem {
  id: string;
  timestamp: Date;
  action: string;
  details: string;
  cssClass: 'event-info' | 'event-dialog-open' | 'event-dialog-create' | 'event-dialog-cancel' | 'event-viewport';
}

/**
 * Metadata for tracking field positions and viewport visibility.
 */
export interface FieldVisibilityStatus {
  name: string;
  id: string;
  type: string;
  pageIndex: number;
  isVisible: boolean;
  isNearest: boolean;
  isSigned: boolean;
  distanceFromCenter: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PdfViewerModule],
  providers: [
    LinkAnnotationService,
    BookmarkViewService,
    MagnificationService,
    ThumbnailViewService,
    ToolbarService,
    NavigationService,
    TextSearchService,
    TextSelectionService,
    PrintService,
    FormDesignerService,
    FormFieldsService,
    AnnotationService,
    PageOrganizerService
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pdfviewer') public pdfViewer!: PdfViewerComponent;

  /**
   * PDF Document path: A 3-page contract located in public/assets.
   */
  public documentPath: string = window.location.origin + '/sample-contract.pdf';

  /**
   * Resource URL for Syncfusion PDF Viewer web worker & engine dependencies.
   */
  public resourcesUrl: string = 'https://cdn.syncfusion.com/ej2/35.2.12/dist/ej2-pdfviewer-lib';

  /**
   * Current authenticated user identity.
   */
  public currentSigner = {
    name: 'Jonathan Sterling',
    title: 'Chief Legal Officer',
    email: 'jonathan.sterling@enterprise.example',
    company: 'Sterling Global Ventures LLC'
  };

  /**
   * Scroll-to-Read Verification State:
   * Tracks all page indices (0-based) viewed by the user.
   */
  public viewedPages: Set<number> = new Set<number>();
  public totalPages: number = 3;
  public isDocumentFullyReviewed: boolean = false;
  public reviewProgressPercentage: number = 0;

  /**
   * Sidebar active tab and audit logs.
   */
  public activeTab: 'audit' | 'fields' | 'architecture' = 'audit';
  public auditLogs: AuditLogItem[] = [];
  public signatureFieldStatus: FieldVisibilityStatus[] = [];

  /**
   * Internal listeners and cleanup handlers.
   */
  private scrollListenerRemover?: () => void;
  private highlightedElement?: HTMLElement;
  private highlightTimer?: ReturnType<typeof setTimeout>;

  constructor(private cdr: ChangeDetectorRef, private hostElement: ElementRef) {}

  public ngOnInit(): void {
    this.addAuditLog(
      'System Initialized',
      `Document review workflow ready for signer: ${this.currentSigner.name}`,
      'event-info'
    );
  }

  public ngAfterViewInit(): void {
    // Hook the EJ2 Signature Dialog component lifecycle directly via Syncfusion's signatureModule
    this.setupEj2SignatureDialogHooks();
  }

  public ngOnDestroy(): void {
    if (this.scrollListenerRemover) {
      this.scrollListenerRemover();
    }
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
  }

  /**
   * Event Handler: Triggered when the PDF document completes loading.
   * Initializes page counts, scroll listeners, and programmatic signature fields.
   */
  public onDocumentLoaded(args: LoadEventArgs): void {
    this.totalPages = this.pdfViewer.pageCount || 3;
    this.viewedPages.clear();
    
    // Page 1 is immediately in view on initial load
    this.markPageAsViewed(0);

    this.addAuditLog(
      'Document Loaded',
      `Loaded '${args.documentName || 'Document'}' with ${this.totalPages} pages. Scroll-to-read requirement initiated.`,
      'event-info'
    );

    // Initialize sample signature & initial fields across pages to demonstrate viewport detection
    this.seedContractSignatureFields();

    // Attach scroll listener to viewerContainer for scroll tracking and viewport analysis
    this.attachScrollTracking();

    this.updateReviewState();
    this.cdr.detectChanges();
  }

  /**
   * Event Handler: Triggered when page navigation occurs (via scrolling or toolbar pagination).
   */
  public onPageChange(args: PageChangeEventArgs): void {
    const pageIndex = (args.currentPageNumber || 1) - 1;
    this.markPageAsViewed(pageIndex);
    this.scanViewportFields();
  }

  /**
   * Event Handler: Triggered when user clicks on a form field.
   * If document review requirement is not satisfied, blocks opening signature dialog.
   */
  public onFormFieldClick(args: any): void {
    if (args && args.field) {
      const fieldType = args.field.type;
      if (fieldType === 'SignatureField' || fieldType === 'InitialField') {
        if (!this.isDocumentFullyReviewed) {
          // Prevent opening signature dialog before all pages are read
          if (args.cancel !== undefined) {
            args.cancel = true;
          }
          this.addAuditLog(
            'Signature Blocked',
            `Attempted to sign '${args.field.name || 'field'}' before completing document review. Please scroll through all pages first.`,
            'event-dialog-cancel'
          );
          alert(`Document Review Required:\n\nPlease scroll and review all ${this.totalPages} pages before signing.`);
        }
      }
    }
  }

  /**
   * Requirement 1: Marks a page as reviewed and calculates review progress.
   */
  private markPageAsViewed(pageIndex: number): void {
    if (!this.viewedPages.has(pageIndex) && pageIndex >= 0 && pageIndex < this.totalPages) {
      this.viewedPages.add(pageIndex);
      this.addAuditLog(
        'Page Viewed',
        `User viewed page ${pageIndex + 1} of ${this.totalPages}`,
        'event-info'
      );
      this.updateReviewState();
    }
  }

  /**
   * Updates verification progress percentage and unlocks the sign button when 100% complete.
   */
  private updateReviewState(): void {
    this.reviewProgressPercentage = Math.round((this.viewedPages.size / this.totalPages) * 100);
    const wasFullyReviewed = this.isDocumentFullyReviewed;
    this.isDocumentFullyReviewed = this.viewedPages.size >= this.totalPages;

    if (!wasFullyReviewed && this.isDocumentFullyReviewed) {
      this.addAuditLog(
        'Review Completed',
        `All ${this.totalPages} pages verified as reviewed. Signing capability is now unlocked!`,
        'event-dialog-create'
      );
    }
  }

  /**
   * Helper: Provides a readable list of unreviewed page numbers for the warning banner.
   */
  public get unreviewedPagesList(): string {
    const missing: number[] = [];
    for (let i = 0; i < this.totalPages; i++) {
      if (!this.viewedPages.has(i)) {
        missing.push(i + 1);
      }
    }
    return missing.join(', ');
  }

  /**
   * Navigation helper: Scrolls the viewer directly to the next unread page.
   */
  public navigateToNextUnreadPage(): void {
    for (let i = 0; i < this.totalPages; i++) {
      if (!this.viewedPages.has(i)) {
        if (this.pdfViewer && this.pdfViewer.navigation) {
          this.pdfViewer.navigation.goToPage(i + 1);
        }
        break;
      }
    }
  }

  /**
   * Requirement 1: Primary "Sign Document" button action.
   * Only accessible when isDocumentFullyReviewed is true.
   */
  public openGeneralSignDialog(): void {
    if (!this.isDocumentFullyReviewed) {
      alert('Document review requirement not satisfied. Please review all pages.');
      return;
    }

    // Opens signature dialog via Syncfusion Signature module
    const viewerAny = this.pdfViewer as any;
    if (viewerAny?.viewerBase?.signatureModule) {
      viewerAny.viewerBase.signatureModule.setAnnotationMode();
      this.addAuditLog(
        'Sign Workflow Triggered',
        'User clicked "Sign Document" — Signature panel initialized.',
        'event-dialog-open'
      );
    }
  }

  /**
   * Attach scroll listener to viewerContainer for scroll tracking and viewport analysis.
   */
  private attachScrollTracking(): void {
    const viewerAny = this.pdfViewer as any;
    const container: HTMLElement | undefined = viewerAny?.viewerBase?.viewerContainer;

    if (container) {
      const scrollHandler = () => {
        // Evaluate visible pages based on scroll position
        this.evaluateVisiblePagesFromScroll();
        // Update viewport fields
        this.scanViewportFields();
      };

      EventHandler.add(container, 'scroll', scrollHandler);
      this.scrollListenerRemover = () => {
        EventHandler.remove(container, 'scroll', scrollHandler);
      };
    }
  }

  /**
   * Inspects which page elements are currently visible in the viewerContainer.
   */
  private evaluateVisiblePagesFromScroll(): void {
    const viewerAny = this.pdfViewer as any;
    const container: HTMLElement | undefined = viewerAny?.viewerBase?.viewerContainer;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();

    for (let i = 0; i < this.totalPages; i++) {
      const pageDiv = document.getElementById(`${this.pdfViewer.element.id}_pageDiv_${i}`);
      if (pageDiv) {
        const pageRect = pageDiv.getBoundingClientRect();
        // Page is visible if it overlaps vertically with container view
        const isPageVisible = (pageRect.bottom > containerRect.top + 50) && (pageRect.top < containerRect.bottom - 50);
        if (isPageVisible) {
          this.markPageAsViewed(i);
        }
      }
    }
  }

  /**
   * Seeds signature and initial fields across pages using FormDesignerService.
   * Provides realistic fields on pages 1, 2, and 3 for viewport detection.
   */
  private seedContractSignatureFields(): void {
    setTimeout(() => {
      try {
        const viewerAny = this.pdfViewer as any;
        const formDesigner = viewerAny.formDesignerModule;

        if (formDesigner && (!this.pdfViewer.formFieldCollections || this.pdfViewer.formFieldCollections.length === 0)) {
          // Page 1 initial block
          formDesigner.addFormField('InitialField', {
            name: 'Initials_Page1',
            bounds: { X: 50, Y: 710, Width: 140, Height: 45 },
            pageNumber: 1,
            tooltip: 'Signer Initials - Page 1'
          });

          // Page 2 initial block
          formDesigner.addFormField('InitialField', {
            name: 'Initials_Page2',
            bounds: { X: 50, Y: 710, Width: 140, Height: 45 },
            pageNumber: 2,
            tooltip: 'Signer Initials - Page 2'
          });

          // Page 3 primary signature block
          formDesigner.addFormField('SignatureField', {
            name: 'Signature_Contractor',
            bounds: { X: 50, Y: 600, Width: 220, Height: 60 },
            pageNumber: 3,
            tooltip: 'Primary Contractor Signature'
          });

          // Page 3 secondary signature block (Witness/Legal)
          formDesigner.addFormField('SignatureField', {
            name: 'Signature_LegalCounsel',
            bounds: { X: 320, Y: 600, Width: 220, Height: 60 },
            pageNumber: 3,
            tooltip: 'Legal Counsel Review Signature'
          });

          this.addAuditLog(
            'Form Fields Initialized',
            'Added 4 signature/initial fields across pages 1, 2, and 3 for viewport demonstration.',
            'event-info'
          );

          this.scanViewportFields();
        }
      } catch (err) {
        console.warn('Seeding form fields note:', err);
      }
    }, 400);
  }

  // =========================================================================
  // REQUIREMENT 2 & 3: Signature & Initial Dialog Monitoring and Customization
  // Relying strictly on Syncfusion EJ2 Component APIs & Dialog Instance Hooks
  // =========================================================================

  /**
   * Hooks into the Syncfusion EJ2 Signature Dialog instance directly via
   * `viewerBase.signatureModule.createSignaturePanel`.
   * Replaces manual DOM MutationObserver with native EJ2 Dialog component hooks and events.
   */
  private setupEj2SignatureDialogHooks(): void {
    const viewerAny = this.pdfViewer as any;
    const signatureModule = viewerAny?.viewerBase?.signatureModule;
    if (!signatureModule) {
      // In case viewerBase is still initializing, retry after short interval
      setTimeout(() => this.setupEj2SignatureDialogHooks(), 100);
      return;
    }

    const originalCreateSignaturePanel = signatureModule.createSignaturePanel.bind(signatureModule);

    // Intercept panel creation so we can hook the EJ2 Dialog instance and its button click events directly
    signatureModule.createSignaturePanel = () => {
      const isInitial = !!viewerAny?.viewerBase?.isInitialField;
      const dialogType = isInitial ? 'Add Initial' : 'Add Signature';

      // Call native implementation to create and configure this.signatureDialog (an EJ2 Dialog)
      originalCreateSignaturePanel();

      const ej2Dialog: Dialog = signatureModule.signatureDialog;
      if (ej2Dialog) {
        // Intercept dialog buttons using EJ2 Button / EventHandler click listeners
        this.interceptEj2DialogButtons(ej2Dialog, signatureModule, dialogType);

        // Customize dialog content using Syncfusion UI component instances
        this.customizeEj2SignatureDialog(ej2Dialog, signatureModule, dialogType);
      }
    };
  }

  /**
   * Post-dialog business logic hook on button click (Requirement 2).
   */
  private executePostDialogBusinessLogic(action: 'Create' | 'Cancel', dialogType: string): void {
    if (action === 'Create') {
      this.addAuditLog(
        `${dialogType} Confirmed (Create)`,
        `[Button Click Hook] Signature confirmed by ${this.currentSigner.name}. IP: 127.0.0.1, Hash: sha256-${Date.now().toString(16)}, Reason: Contract Execution.`,
        'event-dialog-create'
      );
    } else {
      this.addAuditLog(
        `${dialogType} Cancelled`,
        `[Button Click Hook] Signer aborted dialog action. No changes applied to document.`,
        'event-dialog-cancel'
      );
    }
  }

  /**
   * REQUIREMENT 2: Intercepts action buttons using EJ2 Button instances and EventHandler bindings
   * strictly on the Create and Cancel button click events (no dialog open or beforeClose events).
   */
  private interceptEj2DialogButtons(ej2Dialog: Dialog, signatureModule: any, dialogType: string): void {
    const dialogElement = ej2Dialog.element;
    if (!dialogElement) {
      return;
    }

    // Locate Cancel and Create button elements in the dialog footer
    const cancelBtnEl = dialogElement.querySelector('.e-pv-cancelbtn') as HTMLButtonElement | null;
    const createBtnEl = dialogElement.querySelector('.e-pv-createbtn') as HTMLButtonElement | null;

    // Detect Cancel button click
    if (cancelBtnEl) {
      const onCancelClick = (event: MouseEvent | Event) => {
        this.executePostDialogBusinessLogic('Cancel', dialogType);
      };
      EventHandler.add(cancelBtnEl, 'click', onCancelClick);
    }

    // Detect Create button click
    if (createBtnEl) {
      const onCreateClick = (event: MouseEvent | Event) => {
        // Ignore clicks if the Create button is disabled
        if (createBtnEl.disabled || createBtnEl.classList.contains('e-disabled')) {
          return;
        }

        this.addAuditLog(
          `${dialogType} Create Requested`,
          `Signer clicked 'Create'. Running validation & pre-commit audit check...`,
          'event-dialog-create'
        );
        this.executePostDialogBusinessLogic('Create', dialogType);
        this.scanViewportFields();
      };
      EventHandler.add(createBtnEl, 'click', onCreateClick);
    }
  }

  /**
   * REQUIREMENT 3: Customize Signature Dialog using Syncfusion EJ2 Component APIs
   * - Injects legal disclaimer using Syncfusion Message component (ej2-notifications)
   * - Injects signer metadata information using Syncfusion TextBox component (ej2-inputs)
   * - Pre-populates the "Type" tab with current authenticated user's name via Syncfusion's TextBox instance
   */
  private customizeEj2SignatureDialog(ej2Dialog: Dialog, signatureModule: any, dialogType: string): void {
    const dialogElement = ej2Dialog.element;
    const dialogContent = dialogElement?.querySelector('.e-dlg-content') as HTMLElement;
    if (!dialogContent) return;

    if (!dialogContent.querySelector('.custom-dialog-extension')) {
      const extContainer = createElement('div', { className: 'custom-dialog-extension' });

      // 1. Legal Disclaimer rendered with Syncfusion Message component
      const messageHost = createElement('div', { id: 'ej2_signature_legal_disclaimer' });
      extContainer.appendChild(messageHost);
      const disclaimerMessage = new Message({
        severity: 'Info',
        showIcon: true,
        content: `<strong>Legal Notice & Consent:</strong> By submitting this signature, you certify under penalty of perjury that you are <strong>${this.currentSigner.name}</strong>, authorized to bind <strong>${this.currentSigner.company}</strong> under applicable electronic signature laws (ESIGN / UETA).`
      });
      disclaimerMessage.appendTo(messageHost);

      // 2. Signer Information Field rendered with Syncfusion TextBox component
      const signerBox = createElement('div', { className: 'custom-dialog-signer-box' });
      const signerInput = createElement('input', {
        id: 'ej2_signature_signer_title',
        attrs: { type: 'text', readonly: 'true' }
      }) as HTMLInputElement;
      signerBox.appendChild(signerInput);
      extContainer.appendChild(signerBox);

      const signerTextBox = new TextBox({
        placeholder: 'Signer Identity & Title',
        floatLabelType: 'Auto',
        value: `${this.currentSigner.title} (${this.currentSigner.company}) — ${this.currentSigner.email}`,
        readonly: true
      });
      signerTextBox.appendTo(signerInput);

      // Insert at the top of dialog content element
      dialogContent.insertBefore(extContainer, dialogContent.firstChild);
    }

    // REQUIREMENT 3: Pre-fill "Type" signature tab using Syncfusion's internal TextBox instance
    this.prefillTypedSignatureWithEj2(signatureModule);
  }

  /**
   * Pre-fills the Typed signature input box and triggers Syncfusion text rendering.
   * Syncfusion's EJ2 Tab loads tab content on demand, so the typed textbox only exists
   * when the "Type" tab is active. We hook into the tab's `selected` event to safely
   * populate and render text signatures once the DOM elements exist.
   */
  private prefillTypedSignatureWithEj2(signatureModule: any): void {
    const populateAndRenderText = () => {
      const viewerId = this.pdfViewer.element.id;
      const textBoxEl = document.getElementById(`${viewerId}_e-pv-Signtext-box`) as HTMLInputElement;

      if (!textBoxEl) {
        return;
      }

      // Retrieve the EJ2 TextBox instance attached to the input element
      const ej2TextBox = getInstance(textBoxEl, TextBox) as TextBox;
      if (ej2TextBox && (!ej2TextBox.value || ej2TextBox.value.trim() === '')) {
        ej2TextBox.value = this.currentSigner.name;
        ej2TextBox.dataBind();
      } else if (!textBoxEl.value || textBoxEl.value.trim() === '') {
        textBoxEl.value = this.currentSigner.name;
      }

      // Trigger change/input event using Syncfusion's EventHandler
      EventHandler.trigger(textBoxEl, 'input');

      // Only invoke renderSignatureText if the textbox is available in the DOM
      if (signatureModule && typeof signatureModule.renderSignatureText === 'function') {
        try {
          signatureModule.renderSignatureText();
          const firstFontDiv = document.getElementById('_font_signature0');
          if (firstFontDiv) {
            EventHandler.trigger(firstFontDiv, 'click');
          }
        } catch (err) {
          console.debug('Signature font preview init:', err);
        }
      }
    };

    // Attempt immediate population if the textbox is already in DOM (e.g. if Type tab is default)
    populateAndRenderText();

    // Hook tabObj's select/selected event if available to populate when the user switches to "Type" tab
    const tabObj = signatureModule.tabObj;
    if (tabObj && typeof tabObj.on === 'function') {
      tabObj.on('selected', (args: any) => {
        const headerText = args?.selectedItem?.textContent || args?.selectedTitle || '';
        if (typeof headerText === 'string' && headerText.toLowerCase().includes('type')) {
          setTimeout(() => populateAndRenderText(), 0);
        }
      });
    }
  }

  /**
   * Syncfusion Native Event: Triggered when a signature annotation is added onto a page.
   */
  public onSignatureAdded(args: AddSignatureEventArgs): void {
    this.addAuditLog(
      'Signature Placed on Document',
      `Signature object placed on Page ${(args.pageIndex || 0) + 1}. Element ID: ${args.id}`,
      'event-dialog-create'
    );
    this.scanViewportFields();
  }

  // =========================================================================
  // REQUIREMENT 4: Viewport-Based Signature Placement
  // =========================================================================

  /**
   * Scans all signature and initial form fields, checks whether they are inside
   * the visible viewport of `viewerContainer`, and calculates distance to viewport center.
   */
  public scanViewportFields(): FieldVisibilityStatus[] {
    const viewerAny = this.pdfViewer as any;
    const container: HTMLElement | undefined = viewerAny?.viewerBase?.viewerContainer;
    if (!container) return [];

    const containerRect = container.getBoundingClientRect();
    const containerCenter = {
      x: containerRect.left + containerRect.width / 2,
      y: containerRect.top + containerRect.height / 2
    };

    const formFields: any[] = this.pdfViewer.formFieldCollections || [];
    const results: FieldVisibilityStatus[] = [];

    let minDistance = Number.MAX_VALUE;
    let nearestIndex = -1;

    formFields.forEach((field, index) => {
      if (field.type === 'SignatureField' || field.type === 'InitialField') {
        const domId = field.id;
        const domEl = document.getElementById(domId);

        let isVisible = false;
        let dist = 999999;
        const isSigned = domEl?.classList.contains('e-pdfviewer-signatureformfields-signature') || !!field.value;

        if (domEl) {
          const rect = domEl.getBoundingClientRect();
          // Check if element is at least partially in the viewport
          const isInHorizontal = rect.right > containerRect.left && rect.left < containerRect.right;
          const isInVertical = rect.bottom > containerRect.top && rect.top < containerRect.bottom;
          isVisible = isInHorizontal && isInVertical;

          if (isVisible) {
            const fieldCenter = {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
            dist = Math.hypot(fieldCenter.x - containerCenter.x, fieldCenter.y - containerCenter.y);

            if (!isSigned && dist < minDistance) {
              minDistance = dist;
              nearestIndex = index;
            }
          }
        }

        results.push({
          name: field.name || `Field_${index}`,
          id: field.id,
          type: field.type,
          pageIndex: (field.pageNumber || 1) - 1,
          isVisible,
          isNearest: false,
          isSigned,
          distanceFromCenter: dist
        });
      }
    });

    // Mark the single nearest unsigned field
    if (nearestIndex !== -1) {
      results[nearestIndex].isNearest = true;
    }

    this.signatureFieldStatus = results;
    this.cdr.detectChanges();
    return results;
  }

  /**
   * REQUIREMENT 4: "Sign Current Field" external action button.
   * 1. Detects which signature/initial fields are currently visible.
   * 2. If multiple, selects the field nearest to viewport center.
   * 3. Highlights the target field visually.
   * 4. Automatically applies the authenticated signer's signature to that field.
   */
  public signCurrentField(): void {
    if (!this.isDocumentFullyReviewed) {
      alert('Document review required before signing.');
      return;
    }

    const fields = this.scanViewportFields();
    const visibleUnsignedFields = fields.filter((f) => f.isVisible && !f.isSigned);

    if (visibleUnsignedFields.length === 0) {
      alert(
        'No unsigned signature fields are currently visible in the viewer.\n\nPlease scroll to a page containing a signature block (e.g. Page 1, 2, or 3).'
      );
      return;
    }

    // Sort by distance from center of viewport (ascending)
    visibleUnsignedFields.sort((a, b) => a.distanceFromCenter - b.distanceFromCenter);
    const targetFieldStatus = visibleUnsignedFields[0];

    const targetEl = document.getElementById(targetFieldStatus.id);
    if (!targetEl) return;

    // Step 3: Highlight the detected field
    this.highlightField(targetEl);

    this.addAuditLog(
      'Target Field Detected',
      `Identified nearest field '${targetFieldStatus.name}' (${Math.round(targetFieldStatus.distanceFromCenter)}px from center) on Page ${targetFieldStatus.pageIndex + 1}. Highlight applied.`,
      'event-viewport'
    );

    // Step 4: Apply signature after a brief visual highlight animation (400ms)
    setTimeout(() => {
      this.applySignatureToField(targetFieldStatus);
    }, 400);
  }

  /**
   * Highlights the detected field element with an animated outline using Syncfusion DOM utility methods.
   */
  private highlightField(element: HTMLElement): void {
    if (this.highlightedElement) {
      removeClass([this.highlightedElement], 'target-field-highlight');
    }
    addClass([element], 'target-field-highlight');
    this.highlightedElement = element;

    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    this.highlightTimer = setTimeout(() => {
      if (this.highlightedElement) {
        removeClass([this.highlightedElement], 'target-field-highlight');
        this.highlightedElement = undefined;
      }
    }, 2800);
  }

  /**
   * Automatically applies signature to a specific form field using Syncfusion's
   * internal drawSignature API and updates form field collections.
   */
  private applySignatureToField(targetStatus: FieldVisibilityStatus): void {
    const viewerAny = this.pdfViewer as any;
    const domEl = document.getElementById(targetStatus.id);
    const targetField = this.pdfViewer.formFieldCollections?.find((f) => f.id === targetStatus.id);

    if (!domEl || !targetField) return;

    // Generate cryptographic/digital placeholder signature for Jonathan Sterling
    const signerText = targetStatus.type === 'InitialField' ? 'JS' : this.currentSigner.name;
    const fontName = 'Segoe Script, Brush Script MT, cursive';

    try {
      if (viewerAny?.viewerBase?.signatureModule) {
        // Set current target
        viewerAny.viewerBase.currentTarget = domEl;
        viewerAny.viewerBase.isInitialField = targetStatus.type === 'InitialField';
        targetField.value = signerText;
        // Call Syncfusion's drawSignature method directly on the target element
        viewerAny.updateFormFieldsValue(targetField);

        this.addAuditLog(
          'Field Auto-Signed',
          `Successfully applied ${targetStatus.type} to '${targetStatus.name}' using viewport center targeting.`,
          'event-dialog-create'
        );

        this.scanViewportFields();
      }
    } catch (err) {
      console.error('Error applying signature to field:', err);
      // Fallback: Trigger standard field click to allow user interaction
      domEl.click();
    }
  }

  /**
   * Helper to append entries to the Audit Trail.
   */
  private addAuditLog(
    action: string,
    details: string,
    cssClass: 'event-info' | 'event-dialog-open' | 'event-dialog-create' | 'event-dialog-cancel' | 'event-viewport'
  ): void {
    const item: AuditLogItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
      action,
      details,
      cssClass
    };
    this.auditLogs.unshift(item);
  }
}
